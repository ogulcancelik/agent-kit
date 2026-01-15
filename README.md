# agent-kit

A small collection of local-first agent skills, prompts, and optional pi-agent tooling.

## Contents

### `skills/web-browse/`

Web search + fetch/read URLs using a **real browser session** (via CDP).

Key features:
- Search → show snippets → fetch by index (`--fetch 1,3`) or fetch direct URL (`--url ...`).
- Uses a **persistent daemon** by default to keep a warm headless browser session (faster + more resilient on JS-heavy/bot-protected sites).
- Supports launching a headless browser automatically, or connecting to an existing CDP-enabled browser.

Quick start:

```bash
cd skills/web-browse
npm install
npx playwright install chromium
npm test

./web-browse.js "rust async runtime" -n 5
./web-browse.js --fetch 1,3
./web-browse.js --url https://example.com

# daemon controls (optional)
./web-browse.js --daemon status
./web-browse.js --daemon restart
```

### `skills/consult/`

A pi-agent oriented consult workflow: consult other models/agents for second opinions, debugging, and triangulation.

Key features:
- One-shot consult (`ask`) and multi-turn sessions (`start`/`send`/`end`).
- Guardrails: consult is not delegation; the primary agent owns implementation.

## Optional pi tooling

### consult CLI (`pi-consult`)

The `consult` workflow assumes you have a `pi-consult` command available (for example via a wrapper in `~/.local/bin/pi-consult`).

This repo also includes the underlying script so you can run it directly:

```bash
bun ./pi/bin/pi-consult.ts ask -m "opencode:gpt-5.2" "Your question here"
```

Optional (pi): `pi/extensions/consult-status.ts` shows a small UI status indicator while consult runs.

## License

WTFPL v2
