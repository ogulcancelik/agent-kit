/**
 * Consult Status Extension
 * Shows live consultation progress by polling pi-consult's progress file.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";

const PROGRESS_FILE = "/tmp/pi-consult-progress.json";

interface ProgressStatus {
	model: string;
	startTime: number;
	status: "thinking" | "tool" | "streaming" | "done" | "error";
	toolName?: string;
	toolArgs?: string;
	elapsed?: number;
}

export default function (pi: ExtensionAPI) {
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let lastStatus: string | null = null;
	let consultStartTime: number | null = null;
	let lastModel: string | null = null;

	function formatStatus(progress: ProgressStatus): string {
		// Always calculate elapsed from startTime (progress.elapsed can be stale)
		const elapsed = Math.floor((Date.now() - progress.startTime) / 1000);
		const time = `(${elapsed}s)`;
		
		// Track for completion message
		consultStartTime = progress.startTime;
		lastModel = progress.model;
		
		switch (progress.status) {
			case "thinking":
				return `🤖 ${progress.model} thinking... ${time}`;
			case "tool":
				const tool = progress.toolName || "tool";
				return `🤖 ${progress.model} → ${tool} ${time}`;
			case "streaming":
				return `🤖 ${progress.model} responding... ${time}`;
			default:
				return `🤖 ${progress.model} ${time}`;
		}
	}

	function pollProgress(ctx: any) {
		try {
			if (!fs.existsSync(PROGRESS_FILE)) return;

			const content = fs.readFileSync(PROGRESS_FILE, "utf-8");
			const progress: ProgressStatus = JSON.parse(content);
			const statusText = formatStatus(progress);
			
			// Only update if changed (avoid flicker)
			if (statusText !== lastStatus) {
				lastStatus = statusText;
				ctx.ui.notify(statusText, "info");
			}
		} catch {
			// File being written or invalid, ignore
		}
	}

	function startPolling(ctx: any) {
		if (pollInterval) return;
		lastStatus = null;
		pollInterval = setInterval(() => pollProgress(ctx), 500);
		pollProgress(ctx);
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
		lastStatus = null;
	}

	pi.on("tool_call", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.toolName !== "bash") return;
		const command = event.input?.command || "";
		if (!command.includes("pi-consult")) return;

		startPolling(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.toolName !== "bash") return;
		const command = event.input?.command || "";
		if (!command.includes("pi-consult")) return;

		stopPolling();

		// Calculate elapsed from locally tracked time
		const elapsed = consultStartTime 
			? Math.floor((Date.now() - consultStartTime) / 1000)
			: "?";
		
		// Use tracked model, or extract from command as fallback
		let model = lastModel;
		if (!model) {
			const match = command.match(/(?:-m|--model)\s+["']?([^"'\s]+)["']?/);
			model = match ? match[1].split(":").pop() || "agent" : "agent";
		}
		
		if (event.isError) {
			ctx.ui.notify(`❌ ${model} failed (${elapsed}s)`, "error");
		} else {
			ctx.ui.notify(`✓ ${model} responded (${elapsed}s)`, "success");
		}
		
		// Reset tracking
		consultStartTime = null;
		lastModel = null;
	});
}
