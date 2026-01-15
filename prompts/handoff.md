---
description: Create a concise handoff note for the next agent
---

Create a handoff note so another agent can continue without repeating work.

Input: `$ARGUMENTS`
- If provided, treat it as a **slug** (kebab-case) and a short purpose.
- If empty, ask the user for a slug/purpose before writing.

## Where to store it

Prefer a repo-local location when possible:

1. If inside a git repo: write to `<repo-root>/.pi/handoffs/`
2. Otherwise: write to `~/.config/agents/handoffs/`

Create the folder if missing.

Filename format:
- `<YYYY-MM-DD>-<HHMM>-<slug>.md`

## Content (keep it short, high-signal)

Use this structure:

- **Goal / context**: what we’re trying to achieve (1–3 bullets)
- **Current state**: what’s working / what changed
- **What’s left**: next concrete steps (ordered)
- **Bug diary** (if debugging):
  - symptoms
  - hypotheses tested
  - what we tried (commands / code paths)
  - what failed + exact errors
  - what we learned / ruled out
- **Key files / locations**: paths worth opening first
- **Decisions / open questions**: anything unresolved

Avoid fluff. Include enough detail that the next agent can avoid repeating dead ends.

## Final step

Write the handoff markdown file to the chosen directory, then tell the user:
- the file path
- that they can run `/pickup <slug-or-filename>`
