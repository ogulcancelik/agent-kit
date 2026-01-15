import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";

import { resolveBrowserBin } from "./browser-bin.js";

export async function waitForCdpVersion(port, timeoutMs = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { method: "GET" });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (
          payload &&
          typeof payload === "object" &&
          typeof payload.webSocketDebuggerUrl === "string" &&
          payload.webSocketDebuggerUrl.startsWith("ws")
        ) {
          return payload;
        }
      }
    } catch {
      // ignore
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return null;
}

export async function waitForCdp(port, timeoutMs = 10000) {
  return Boolean(await waitForCdpVersion(port, timeoutMs));
}

async function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();

    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;

      server.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("Could not determine ephemeral port"));
        resolve(port);
      });
    });
  });
}

async function isPortAvailable(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;

  return new Promise((resolve) => {
    const server = createNetServer();
    server.unref();

    server.once("error", () => resolve(false));

    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function chooseAvailablePort(preferredPort) {
  if (await isPortAvailable(preferredPort)) return preferredPort;

  for (let offset = 1; offset <= 25; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isPortAvailable(candidate)) return candidate;
  }

  return await getEphemeralPort();
}

export async function startBrowserForCdp(preferredPort, profileDir, browserBin = null, spawnedProcessGroupPids = null) {
  const bin = resolveBrowserBin(browserBin);
  const port = await chooseAvailablePort(preferredPort);

  const args = [
    "--ozone-platform=headless",
    "--ozone-override-screen-size=1280,720",
    "--no-first-run",
    "--no-default-browser-check",

    // Reduce background throttling so JS challenges (e.g., Anubis PoW) run at normal speed.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",

    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];

  const env = { ...process.env };
  // Prevent any UI from connecting to the current Wayland/X11 session.
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;

  const proc = spawn(bin, args, { stdio: "ignore", detached: true, env });
  proc.unref();

  if (spawnedProcessGroupPids && proc.pid) {
    spawnedProcessGroupPids.add(proc.pid);
  }

  const ready = await waitForCdp(port, 15000);
  if (!ready) {
    if (spawnedProcessGroupPids && proc.pid) spawnedProcessGroupPids.delete(proc.pid);

    try {
      process.kill(-proc.pid);
    } catch {
      // ignore
    }

    throw new Error(`Failed to start browser with CDP on port ${port} (bin=${bin})`);
  }

  return { proc, port, bin };
}

export function isLikelyUsableBrowserCdp(versionPayload) {
  if (!versionPayload || typeof versionPayload !== "object") return false;

  const userAgent = typeof versionPayload["User-Agent"] === "string" ? versionPayload["User-Agent"] : "";
  if (userAgent.toLowerCase().includes("electron/")) return false;

  return true;
}

export async function resolveCdpOptions({ useCdpFlag, cdpStartFlag, cdpPortValue }) {
  let effectiveUseCdp = useCdpFlag || cdpStartFlag;
  let effectiveCdpStart = cdpStartFlag;
  let effectiveCdpPort = cdpPortValue;

  if (!effectiveUseCdp && !effectiveCdpStart) {
    const cdp9223 = await waitForCdpVersion(9223, 1000);
    if (isLikelyUsableBrowserCdp(cdp9223)) {
      effectiveUseCdp = true;
      effectiveCdpPort = 9223;
    } else {
      const cdp9222 = await waitForCdpVersion(9222, 1000);
      if (isLikelyUsableBrowserCdp(cdp9222)) {
        effectiveUseCdp = true;
        effectiveCdpPort = 9222;
      } else {
        effectiveUseCdp = true;
        effectiveCdpStart = true;
        effectiveCdpPort = 9223;
      }
    }
  }

  return {
    useCdp: effectiveUseCdp,
    cdpStart: effectiveCdpStart,
    cdpPort: effectiveCdpPort,
  };
}
