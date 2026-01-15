---
description: Resume work from a previous handoff note
---

Resume from a handoff note.

Requested: `$ARGUMENTS`
- If empty: list available handoffs.
- If provided: treat as a filename (`*.md`) OR a slug/substring to search.

## Where to look

1. If inside a git repo: `<repo-root>/.pi/handoffs/`
2. Also check: `~/.config/agents/handoffs/`

## If no argument

Print a short list of handoff files from both locations:
- show filename + the first `# ` title line
- then ask which one to pick up

## If argument provided

1. Find matching handoff file(s):
   - exact filename match preferred
   - otherwise substring match on filename (slug)
2. If multiple matches: show a numbered list and ask the user to choose.
3. Read the selected file.

## After reading

1. Summarize what we’re continuing (1–2 sentences)
2. Call out:
   - what’s already tried / ruled out (so we don’t repeat)
   - the next step suggested by the handoff
3. Ask whether to proceed with that next step or adjust.
