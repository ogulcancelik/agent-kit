#!/usr/bin/env bun
/**
 * pi-consult: Agent-to-agent consultation via pi RPC
 *
 * Commands:
 *   pi-consult start -m <model>              Start a session, print session ID
 *   pi-consult send -s <session> <message>   Send message, wait for response, print it
 *   pi-consult end -s <session>              End session (cleanup)
 *
 * Single-shot (convenience):
 *   pi-consult ask -m <model> <message>      One-off question (no session management)
 */

import { spawn } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// =============================================================================
// Types
// =============================================================================

interface SessionInfo {
	id: string;
	model: string;
	provider: string;
	modelId: string;
	thinking?: string;
	tools: string;  // Default to read-only
	sessionFile: string;
	createdAt: number;
}

interface SendResult {
	response: string;
	usage?: {
		input: number;
		output: number;
		cost: number;
	};
}

// =============================================================================
// Session Directory Management
// =============================================================================

function getSessionDir(): string {
	const dir = path.join(os.tmpdir(), "pi-consult-sessions");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function getSessionInfoPath(sessionId: string): string {
	return path.join(getSessionDir(), `${sessionId}.info.json`);
}

function getSessionFilePath(sessionId: string): string {
	return path.join(getSessionDir(), `${sessionId}.jsonl`);
}

function saveSessionInfo(info: SessionInfo): void {
	fs.writeFileSync(getSessionInfoPath(info.id), JSON.stringify(info, null, 2));
}

function validateSessionId(sessionId: string): void {
	if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
		throw new Error(`Invalid session ID: ${sessionId} (only alphanumeric, dash, underscore allowed)`);
	}
}

function loadSessionInfo(sessionId: string): SessionInfo {
	validateSessionId(sessionId);
	const infoPath = getSessionInfoPath(sessionId);
	if (!fs.existsSync(infoPath)) {
		throw new Error(`Session not found: ${sessionId}`);
	}
	return JSON.parse(fs.readFileSync(infoPath, "utf-8"));
}

function closeSession(sessionId: string): void {
	validateSessionId(sessionId);
	const info = loadSessionInfo(sessionId);
	(info as any).status = "closed";
	(info as any).closedAt = Date.now();
	saveSessionInfo(info);
}

function purgeSession(sessionId: string): void {
	validateSessionId(sessionId);
	const infoPath = getSessionInfoPath(sessionId);
	const sessionFile = getSessionFilePath(sessionId);
	if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
	if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
}

// =============================================================================
// Core: Send message to pi via RPC (Event-Driven)
// =============================================================================

/**
 * Extract text content from an assistant message (fallback for non-streaming)
 */
function extractTextFromMessage(message: any): string {
	if (!message) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c: any) => c?.type === "text" && typeof c.text === "string")
			.map((c: any) => c.text)
			.join("\n\n");
	}
	return "";
}

// Progress file for live status updates (read by extension)
const PROGRESS_FILE = "/tmp/pi-consult-progress.json";

interface ProgressStatus {
	model: string;
	startTime: number;
	status: "thinking" | "tool" | "streaming" | "done" | "error";
	toolName?: string;
	toolArgs?: string;
	elapsed?: number;
}

function writeProgress(status: ProgressStatus) {
	try {
		status.elapsed = Math.floor((Date.now() - status.startTime) / 1000);
		fs.writeFileSync(PROGRESS_FILE, JSON.stringify(status));
	} catch { /* ignore */ }
}

function clearProgress() {
	try {
		if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
	} catch { /* ignore */ }
}

async function sendToAgent(message: string, info: SessionInfo, timeout: number): Promise<SendResult> {
	// Resolve pi binary (support override via env)
	const piBin = process.env.PI_CONSULT_PI_BIN || "pi";
	
	// Initialize progress
	const startTime = Date.now();
	const modelName = info.modelId;
	writeProgress({ model: modelName, startTime, status: "thinking" });

	// Build pi args
	// --no-extensions: consulted agent runs headless, no UI extensions needed
	const args = [
		"--mode", "rpc",
		"--no-extensions",
		"--provider", info.provider,
		"--model", info.modelId,
		"--session", info.sessionFile,
	];

	if (info.thinking) {
		args.push("--thinking", info.thinking);
	}

	if (info.tools) {
		args.push("--tools", info.tools);
	}

	// Spawn pi process
	const proc = spawn(piBin, args, {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});

	// Collect stderr for debugging
	let stderr = "";
	proc.stderr?.on("data", (data) => {
		stderr += data.toString();
	});

	// Set up line reader for JSON events
	const rl = readline.createInterface({
		input: proc.stdout!,
		terminal: false,
	});

	// State
	let responseText = "";
	let usage: SendResult["usage"];
	let agentMessages: any[] = [];
	let finished = false;

	// Request/response correlation
	let reqId = 0;
	const pending = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void }>();

	function sendCommand(command: Record<string, unknown>): Promise<any> {
		const id = `req-${++reqId}`;
		const payload = JSON.stringify({ id, ...command });
		proc.stdin!.write(payload + "\n");
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});
	}

	// Completion promise (resolved on agent_end, rejected on error)
	let resolveDone!: () => void;
	let rejectDone!: (err: Error) => void;
	const donePromise = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});

	// Process events
	rl.on("line", (line) => {
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return; // Ignore non-JSON lines
		}

		// Handle command responses (handshake, prompt acknowledgment)
		if (event.type === "response") {
			const waiter = event.id ? pending.get(event.id) : undefined;
			if (event.id) pending.delete(event.id);

			if (waiter) {
				if (!event.success) {
					waiter.reject(new Error(event.error || "Unknown error"));
				} else {
					waiter.resolve(event.data);
				}
			} else if (!event.success) {
				// Untracked error response - fail the whole operation
				rejectDone(new Error(event.error || "Unknown error"));
			}
			return;
		}

		// Handle streaming text
		if (event.type === "message_update") {
			const delta = event.assistantMessageEvent;
			if (delta?.type === "text_delta") {
				responseText += delta.delta;
				resetTimeout();
				writeProgress({ model: modelName, startTime, status: "streaming" });
			}
			if (delta?.type === "thinking_delta") {
				resetTimeout();
				writeProgress({ model: modelName, startTime, status: "thinking" });
			}
			if (delta?.type === "error") {
				rejectDone(new Error(delta.reason ?? "Streaming error"));
			}
			return;
		}

		// Handle errors in assistant messages
		if (event.type === "message_end") {
			const msg = event.message;
			if (msg?.errorMessage) {
				rejectDone(new Error(msg.errorMessage));
			}
			return;
		}

		// Handle tool execution (for progress display)
		if (event.type === "tool_execution_start") {
			resetTimeout();
			writeProgress({ 
				model: modelName, 
				startTime, 
				status: "tool",
				toolName: event.toolName,
				toolArgs: JSON.stringify(event.args || {}).slice(0, 100)
			});
			return;
		}
		if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
			resetTimeout();
			return;
		}

		// Handle completion
		if (event.type === "agent_end") {
			agentMessages = event.messages || [];

			// Accumulate usage across ALL assistant messages in this turn
			// (fixes bug: multi-step responses were only counting last step)
			usage = { input: 0, output: 0, cost: 0 };
			for (const msg of agentMessages) {
				if (msg.role === "assistant" && msg.usage) {
					usage.input += msg.usage.input || 0;
					usage.output += msg.usage.output || 0;
					usage.cost += msg.usage.cost?.total || 0;
				}
			}

			// Fallback: if streaming produced no text, extract from final message
			if (responseText.trim() === "") {
				const lastAssistant = [...agentMessages].reverse().find((m: any) => m?.role === "assistant");
				responseText = extractTextFromMessage(lastAssistant);
			}

			finished = true;
			resolveDone();
			return;
		}

		// Treat hook errors as fatal
		if (event.type === "hook_error") {
			rejectDone(new Error(`Hook error: ${event.error || "Unknown"}`));
		}
	});

	// Handle unexpected process exit
	proc.on("exit", (code, signal) => {
		if (!finished) {
			rejectDone(new Error(`pi process exited unexpectedly (${code ?? signal}).\nStderr: ${stderr}`));
		}
	});

	// Sliding timeout - resets on activity (so long-running but active tasks don't get killed)
	let timeoutHandle: ReturnType<typeof setTimeout>;
	let timeoutReject: (err: Error) => void;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutReject = reject;
		timeoutHandle = setTimeout(() => {
			reject(new Error(`Timeout after ${timeout}ms waiting for response.\nStderr: ${stderr}`));
		}, timeout);
	});

	function resetTimeout() {
		clearTimeout(timeoutHandle);
		timeoutHandle = setTimeout(() => {
			timeoutReject(new Error(`Timeout after ${timeout}ms of inactivity.\nStderr: ${stderr}`));
		}, timeout);
	}

	try {
		// Handshake: wait for agent to be ready (replaces the 200ms sleep)
		await Promise.race([sendCommand({ type: "get_state" }), timeoutPromise]);

		// Send prompt and wait for acknowledgment
		await Promise.race([sendCommand({ type: "prompt", message }), timeoutPromise]);

		// Wait for agent_end (event-driven completion)
		await Promise.race([donePromise, timeoutPromise]);

		return {
			response: responseText.trim(),
			usage,
		};
	} finally {
		// Cleanup
		clearTimeout(timeoutHandle!);
		clearProgress();
		rl.close();
		proc.stdin?.end();
		proc.kill("SIGTERM");
	}
}

// =============================================================================
// Commands
// =============================================================================

interface StartOptions {
	model: string;
	thinking?: string;
	tools?: string;
	name?: string;
}

// Default: read-only tools (consulted agents shouldn't modify files)
const DEFAULT_TOOLS = "read,grep,find,ls";

function validateSessionName(name: string): void {
	// Only allow alphanumeric, hyphens, underscores
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		throw new Error(`Invalid session name: "${name}". Only alphanumeric, hyphens, and underscores allowed.`);
	}
	if (name.length > 64) {
		throw new Error(`Session name too long (max 64 chars): "${name}"`);
	}
}

async function cmdStart(options: StartOptions): Promise<string> {
	// Parse model string
	const modelParts = options.model.split(":");
	if (modelParts.length < 2) {
		throw new Error(`Invalid model format: ${options.model}. Expected "provider:model"`);
	}
	const provider = modelParts[0];
	const modelId = modelParts.slice(1).join(":");

	// Create session ID (use name if provided, otherwise UUID)
	let sessionId: string;
	if (options.name) {
		validateSessionName(options.name);
		// Check if session with this name already exists
		const existingPath = getSessionInfoPath(options.name);
		if (fs.existsSync(existingPath)) {
			throw new Error(`Session "${options.name}" already exists. End it first or choose a different name.`);
		}
		sessionId = options.name;
	} else {
		sessionId = crypto.randomUUID();
	}

	const info: SessionInfo = {
		id: sessionId,
		model: options.model,
		provider,
		modelId,
		thinking: options.thinking,
		tools: options.tools || DEFAULT_TOOLS,
		sessionFile: getSessionFilePath(sessionId),
		createdAt: Date.now(),
	};

	saveSessionInfo(info);
	return sessionId;
}

interface SendOptions {
	session: string;
	timeout?: number;
}

async function cmdSend(message: string, options: SendOptions): Promise<SendResult> {
	const info = loadSessionInfo(options.session);
	const timeout = options.timeout || 300000; // 5 min default
	return sendToAgent(message, info, timeout);
}

function cmdEnd(sessionId: string): void {
	closeSession(sessionId);
}

function cmdPurge(sessionId: string): void {
	purgeSession(sessionId);
}

interface AskOptions {
	model: string;
	thinking?: string;
	tools?: string;
	timeout?: number;
}

async function cmdAsk(message: string, options: AskOptions): Promise<SendResult> {
	// Start, send, end in one go
	const sessionId = await cmdStart({
		model: options.model,
		thinking: options.thinking,
		tools: options.tools || DEFAULT_TOOLS,
	});

	try {
		const result = await cmdSend(message, {
			session: sessionId,
			timeout: options.timeout,
		});
		return result;
	} finally {
		// Always cleanup
		cmdEnd(sessionId);
	}
}

// =============================================================================
// CLI
// =============================================================================

function printUsage() {
	console.error(`
pi-consult: Agent-to-agent consultation via pi RPC

Commands:
  start   Start a new consultation session
  send    Send a message and wait for response
  end     Close a session (keeps history, can rejoin later)
  purge   Delete a session completely (removes all files)
  ask     One-shot question (no session management)
  list    List sessions

Usage:
  pi-consult start -m <provider:model> [options]
  pi-consult send -s <session> <message>
  pi-consult end -s <session>
  pi-consult purge -s <session>
  pi-consult ask -m <provider:model> [options] <message>
  pi-consult list

Options:
  -m, --model <provider:model>   Model (e.g., opencode:gpt-5.2)
  -s, --session <name|id>        Session name or ID
  -n, --name <name>              Human-friendly session name (for start)
  -t, --thinking <level>         Thinking: off, minimal, low, medium, high
  --tools <list>                 Comma-separated tools (default: read,grep,find,ls - read-only)
  --timeout <ms>                 Timeout in ms (default: 300000)

Examples:
  # Start a named brainstorm session
  pi-consult start -m "opencode:gpt-5.2" -t high -n gtk-debug
  
  # Have a conversation using the name
  pi-consult send -s gtk-debug "I'm debugging a GTK theme issue..."
  pi-consult send -s gtk-debug "Good point. What about the decoration node?"
  
  # Close when done (can rejoin later with 'send')
  pi-consult end -s gtk-debug
  
  # Or delete completely when you're sure
  pi-consult purge -s gtk-debug

  # Or one-shot (no session management)
  pi-consult ask -m "anthropic:claude-sonnet-4-20250514" "Quick question about X"
`);
}

function isUUID(str: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function cmdList(): void {
	const dir = getSessionDir();
	const files = fs.readdirSync(dir).filter(f => f.endsWith(".info.json"));
	
	if (files.length === 0) {
		console.log("No sessions");
		return;
	}

	console.log("Sessions:");
	for (const file of files) {
		try {
			const info: SessionInfo & { status?: string } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
			const age = Math.round((Date.now() - info.createdAt) / 1000 / 60);
			const idDisplay = isUUID(info.id) ? info.id.slice(0, 8) + "..." : info.id;
			const status = info.status === "closed" ? "closed" : "active";
			console.log(`  ${idDisplay.padEnd(20)}  ${info.model.padEnd(25)}  ${status.padEnd(8)}  (${age}m ago)`);
		} catch {
			// Skip corrupted files
		}
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printUsage();
		process.exit(args.length === 0 ? 1 : 0);
	}

	const command = args[0];
	const restArgs = args.slice(1);

	// Parse common options
	let model = "";
	let session = "";
	let thinking = "";
	let tools = "";
	let timeout = 300000;
	let name = "";
	let messageArgs: string[] = [];

	for (let i = 0; i < restArgs.length; i++) {
		const arg = restArgs[i];
		switch (arg) {
			case "--model":
			case "-m":
				model = restArgs[++i];
				break;
			case "--session":
			case "-s":
				session = restArgs[++i];
				break;
			case "--thinking":
			case "-t":
				thinking = restArgs[++i];
				break;
			case "--tools":
				tools = restArgs[++i];
				break;
			case "--timeout":
				timeout = parseInt(restArgs[++i], 10);
				break;
			case "--name":
			case "-n":
				name = restArgs[++i];
				break;
			default:
				if (!arg.startsWith("-")) {
					messageArgs = restArgs.slice(i);
					i = restArgs.length;
				} else {
					console.error(`Unknown option: ${arg}`);
					process.exit(1);
				}
		}
	}

	const message = messageArgs.join(" ");

	try {
		switch (command) {
			case "start": {
				if (!model) {
					console.error("Error: --model is required for start");
					process.exit(1);
				}
				const sessionId = await cmdStart({ model, thinking, tools, name });
				console.log(sessionId);
				break;
			}

			case "send": {
				if (!session) {
					console.error("Error: --session is required for send");
					process.exit(1);
				}
				if (!message) {
					console.error("Error: message is required for send");
					process.exit(1);
				}
				const result = await cmdSend(message, { session, timeout });
				if (result.usage) {
					console.error(`[${result.usage.input}in/${result.usage.output}out, $${result.usage.cost.toFixed(4)}]`);
				}
				console.log(result.response);
				break;
			}

			case "end": {
				if (!session) {
					console.error("Error: --session is required for end");
					process.exit(1);
				}
				cmdEnd(session);
				console.error(`Session ${session} closed (can rejoin with 'send')`);
				break;
			}

			case "purge": {
				if (!session) {
					console.error("Error: --session is required for purge");
					process.exit(1);
				}
				cmdPurge(session);
				console.error(`Session ${session} purged`);
				break;
			}

			case "ask": {
				if (!model) {
					console.error("Error: --model is required for ask");
					process.exit(1);
				}
				if (!message) {
					console.error("Error: message is required for ask");
					process.exit(1);
				}
				const result = await cmdAsk(message, { model, thinking, tools, timeout });
				if (result.usage) {
					console.error(`[${result.usage.input}in/${result.usage.output}out, $${result.usage.cost.toFixed(4)}]`);
				}
				console.log(result.response);
				break;
			}

			case "list": {
				cmdList();
				break;
			}

			default:
				console.error(`Unknown command: ${command}`);
				printUsage();
				process.exit(1);
		}
	} catch (err: any) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

main();
