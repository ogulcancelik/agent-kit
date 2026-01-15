---
name: consult
description: "Consult other AI models (GPT-5.2, Opus, Gemini 3) for second opinions, brainstorming, triangulation, or code review. Not for delegation: the primary agent owns implementation."
---

# Consult Skill

Consult other AI models when you need a second opinion (debugging, architecture, review).

## Key Behavior

- The consulted agent runs **inside Pi** (RPC mode) in your **current working directory**.
- By default it has **read-only tools**: `read,grep,find,ls`.
- It can inspect the repo itself — you usually **do not** need to paste file contents; give file paths + what to look for.

## Guardrails (consult is not delegation)

Use consult like an advisor/reviewer. **You (the primary agent) own the final implementation**.

- **Do not delegate work**: don’t ask the consulted model to “write the complete file contents”, “draft exact patches”, or otherwise act as your coder.
- **Prefer reasoning over code**: ask for ranked hypotheses, where-to-look pointers, invariants to check, and debugging experiments.
- **If code is needed, keep it illustrative**: request small snippets (e.g., <20 lines) or a minimal diff sketch, not full files.
- **Always verify**: treat consult output as untrusted; confirm against the repo and your own tool results.

## Triangulation / debate patterns

When the problem is subtle or flaky, explicitly ask for disagreement and evidence:

- “Give the strongest case for hypothesis A, then the strongest case against it.”
- “List 3 alternative explanations and what log/trace would falsify each.”
- “Assume the obvious explanation is wrong—what else could produce the same symptom?”
- “Critique this other model’s conclusion: <paste 5–10 lines>.”

## Models

| Model | Use For |
|-------|---------|
| `opencode:gpt-5.2` | Code review, debugging, architecture |
| `anthropic:claude-opus-4-5` | Deep reasoning, complex analysis |
| `opencode:gemini-3-pro` | Alternative perspective, large context |

## One-Shot

Run from the repo you want it to inspect:

```bash
bun ~/.local/bin/pi-consult ask -m "opencode:gpt-5.2" "Your question here"
```

## Multi-Turn

```bash
session=$(bun ~/.local/bin/pi-consult start -m "opencode:gpt-5.2" -t high -n my-topic)

bun ~/.local/bin/pi-consult send -s "$session" "First question"
bun ~/.local/bin/pi-consult send -s "$session" "Follow-up"

bun ~/.local/bin/pi-consult end -s "$session"
```

## Timeouts

- Default: `--timeout 300000` (5 min)
- Timeout is **sliding** (activity resets it)
- For deep dives use 10–20 min:

```bash
bun ~/.local/bin/pi-consult ask -m "opencode:gpt-5.2" --timeout 900000 "..."
```

## Writing a Good Consult Prompt (important)

The consulted agent has read-only tools and can explore the repo itself — you don't need to paste file contents. Give pointers so it can investigate:

- **Goal**: what you want (diagnosis, plan, review, alternatives)
- **Where to look**: file paths + symbols + suggested search terms
- **What you already tried**: include dead ends + exact errors so it won't repeat
- **Output format**: bullets, checklist, patch sketch, etc.

Template:

```
Goal: <what you want>
Problem: <symptoms + exact error>
Already tried / ruled out:
- ...
Pointers:
- Start in <path>
- Search for: <symbol1>, <symbol2>
Constraints:
- read-only; don't suggest changes requiring sudo
- don’t write complete files/patches; prefer reasoning + small snippets or a minimal diff sketch
Output:
- 3–6 likely causes (ranked)
- next 3 steps to validate (specific logs/traces/searches)
- optional: minimal diff sketch (files + key lines)
```

## Options

| Option | Description |
|--------|-------------|
| `-m, --model` | `provider:model` (required) |
| `-s, --session` | Session ID/name for multi-turn |
| `-t, --thinking` | `off`, `minimal`, `low`, `medium`, `high` |
| `--tools` | Tool allowlist (default: `read,grep,find,ls`) |
| `--timeout` | Timeout in ms (default: 300000) |

## Session Management

- `end` closes a session but keeps history (can rejoin with `send`)
- `purge` deletes a session completely
- Sessions live in `/tmp/` and are cleaned on reboot

## Notes

- Pi shows consult progress via `~/.pi/agent/extensions/consult-status.ts` (reads `/tmp/pi-consult-progress.json`).
