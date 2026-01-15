---
name: web-browse
description: "Use this to search the internet or fetch/read a URL in a real browser session (headless Brave via CDP). Prefer this over curl for JS-heavy or bot-protected sites."
---

# Web Browse

Search the web, then open/fetch pages in a **real browser session** (headless Brave via CDP) and extract readable text.
Use this instead of `curl` when sites are JS-heavy or bot-protected.

## Setup

```bash
cd ~/.config/agents/skills/web-browse
npm install
npx playwright install chromium
```

## Configuration (optional)

- `WEB_BROWSE_BROWSER_BIN`: browser binary to launch (defaults to trying: brave/brave-browser/chrome/chromium)
- `BRAVE_BIN`: supported for backwards compatibility
- `WEB_BROWSE_USER_AGENT`: override User-Agent
- `WEB_BROWSE_DEBUG_DUMP=1`: save `screenshot.png` + `content.html` to `/tmp/web-browse-dump-*` on failures

You can also pass `--browser-bin <path>`.

## Usage

```bash
# Search (results are cached for ~10 minutes)
./web-browse.js "your query"
./web-browse.js "your query" -n 10

# Fetch specific cached results by index
./web-browse.js --fetch 1,3,5

# Fetch a specific URL
./web-browse.js --url <url>          # truncated (~2000 chars)
./web-browse.js --url <url> --full   # full content
```

## Default behavior: persistent daemon (auto)

Direct calls automatically start/use a local daemon that keeps a **persistent headless Brave+CDP session**.
This avoids browser startup overhead and helps with bot-protection pages that auto-clear (e.g. Anubis PoW).

### Daemon controls (optional, for debugging)

```bash
./web-browse.js --daemon status
./web-browse.js --daemon start
./web-browse.js --daemon stop
./web-browse.js --daemon restart
```

### Bypass daemon (one-shot)

```bash
./web-browse.js --no-daemon --url https://example.com
./web-browse.js --no-daemon "your query"
```

## Workflow

1) **Search** → see snippets → decide what to read
2) **Fetch by index** → `--fetch 1,3` opens those results and extracts content

```bash
./web-browse.js "rust async runtime"  # shows results
./web-browse.js --fetch 1,3           # fetches result #1 and #3
```

## Notes

- `./search.js` is kept as a wrapper for backwards compatibility.
- Content is truncated by default to save tokens; use `--full` for complete.
