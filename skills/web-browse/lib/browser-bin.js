import { accessSync, constants } from "node:fs";
import { join } from "node:path";

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableOnPath(name, env = process.env) {
  if (!name) return null;

  // Absolute/relative path
  if (name.includes("/")) {
    return isExecutableFile(name) ? name : null;
  }

  const pathEnv = env.PATH || "";
  const dirs = pathEnv.split(":").filter(Boolean);

  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }

  return null;
}

/**
 * Resolve a browser binary for CDP automation.
 *
 * Precedence:
 *  - preferredBin (CLI)
 *  - WEB_BROWSE_BROWSER_BIN
 *  - BRAVE_BIN (backwards compat)
 *  - common defaults on PATH
 */
export function resolveBrowserBin(preferredBin = null, env = process.env) {
  const candidates = [
    preferredBin,
    env.WEB_BROWSE_BROWSER_BIN,
    env.BRAVE_BIN,
    "brave",
    "brave-browser",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);

  for (const cand of candidates) {
    const resolved = findExecutableOnPath(cand, env);
    if (resolved) return resolved;
  }

  throw new Error(
    "No supported browser binary found. Set WEB_BROWSE_BROWSER_BIN or BRAVE_BIN, or pass --browser-bin <path>." +
      " Tried: " +
      candidates.join(", "),
  );
}
