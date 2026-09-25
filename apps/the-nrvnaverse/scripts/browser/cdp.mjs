// @ts-check
/**
 * Dependency-free Chrome DevTools Protocol plumbing for the app's browser probes (M1.0).
 *
 * Node's built-in `fetch` / `WebSocket` and an installed Chrome (CHROME_PATH overrides the default
 * locations); `next start` against the existing production build. Used by `perf-probe.mjs`
 * (`pnpm browser:perf`). `touch-regression.mjs` (`pnpm browser:touch`) predates this module and keeps
 * its own copy of the same pattern for now.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {...unknown} a */
export const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

/** An installed Chrome, or undefined. */
export const CHROME =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => fs.existsSync(p));

export class CDP {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, method: string }>} */
    this.pending = new Map();
    /** @type {Map<string, Array<(params: any) => void>>} */
    this.handlers = new Map();
    /** Console errors and uncaught exceptions. @type {string[]} */
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`)) : p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
      }
    });
  }
  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /**
   * @param {string} method
   * @param {(params: any) => void} handler
   */
  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
  }
  /**
   * @param {string} expression
   * @returns {Promise<any>}
   */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** @param {ChildProcess | null | undefined} child */
export function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
}

/**
 * Remove a throw-away directory; Chrome can hold files briefly after it is killed, so retry.
 * @param {string | null | undefined} dir
 */
export async function removeDir(dir) {
  if (!dir) return;
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
}

/** @param {string} url */
async function answers(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Headless Chrome with a throw-away profile (so every run starts with a cold HTTP cache). The caller
 * kills `child` and removes `profileDir` ({@link removeDir}). Refuses a DevTools port that already
 * answers: a leftover Chrome would otherwise be driven (and measured) instead of this one.
 * @param {string} chromePath
 * @param {number} port
 * @returns {Promise<{ child: ChildProcess, profileDir: string }>}
 */
export async function launchChrome(chromePath, port) {
  if (await answers(`http://127.0.0.1:${port}/json/version`)) throw new Error(`port ${port} already exposes a DevTools endpoint (a leftover Chrome?) — stop it or set CDP_PORT`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nrvna-probe-chrome-"));
  const child = spawn(
    chromePath,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check", "--disable-background-timer-throttling", "about:blank"],
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return { child, profileDir: profile };
    } catch {}
    await sleep(200);
  }
  killTree(child);
  await removeDir(profile);
  throw new Error("Chrome did not expose the DevTools port");
}

/**
 * `next start` on the existing production build, unless BASE_URL points at a running server (then
 * `external: true`: nothing proves that server is a production build of this tree, and callers
 * report it). Exits with code 2 when there is no build or the port already answers — a leftover
 * server would otherwise be measured silently instead of the one started here.
 * @param {number} port
 * @returns {Promise<{ base: string, child: ChildProcess | null, external: boolean }>}
 */
export async function startServer(port) {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL.replace(/\/$/, ""), child: null, external: true };
  if (!fs.existsSync(path.join(APP_DIR, ".next", "BUILD_ID"))) {
    console.error("No production build: run `pnpm --filter the-nrvnaverse build` first.");
    process.exit(2);
  }
  if (await answers(`http://127.0.0.1:${port}/`)) {
    console.error(`Port ${port} is already serving (a leftover server?). Stop it or set PORT.`);
    process.exit(2);
  }
  const nextBin = path.join(APP_DIR, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(port)], { cwd: APP_DIR, stdio: "ignore", detached: process.platform !== "win32" });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/")).ok) return { base, child, external: false };
    } catch {}
    await sleep(200);
  }
  killTree(child);
  throw new Error("next start did not answer on " + base);
}

/**
 * Whether the production build predates its inputs: every file under the app's sources / static
 * data / config modified after `.next/BUILD_ID`. A stale build measures old code, so callers report
 * (and fail on) it.
 * @returns {{ buildId: string | null, builtAt: string | null, newerSources: string[] }}
 */
export function buildFreshness() {
  const idFile = path.join(APP_DIR, ".next", "BUILD_ID");
  if (!fs.existsSync(idFile)) return { buildId: null, builtAt: null, newerSources: [] };
  const builtMs = fs.statSync(idFile).mtimeMs;
  /** @type {string[]} */
  const newer = [];
  /** @param {string} p */
  const visit = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const name of fs.readdirSync(p)) visit(path.join(p, name));
    else if (st.mtimeMs > builtMs) newer.push(path.relative(APP_DIR, p).split(path.sep).join("/"));
  };
  for (const input of ["src", "public", "next.config.ts", "package.json"]) visit(path.join(APP_DIR, input));
  return { buildId: fs.readFileSync(idFile, "utf8").trim(), builtAt: new Date(builtMs).toISOString(), newerSources: newer.sort() };
}

/**
 * A new page with Page / Runtime / Network enabled and console errors collected.
 * @param {number} port
 * @returns {Promise<CDP>}
 */
export async function newPage(port) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable", { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 20_000_000 });
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      cdp.errors.push(p.args.map((/** @type {{ value?: unknown, description?: string }} */ a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    }
  });
  cdp.on("Runtime.exceptionThrown", (p) => cdp.errors.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").slice(0, 300)));
  return cdp;
}

/**
 * Poll an expression until it is truthy.
 * @param {CDP} cdp
 * @param {string} expression
 * @param {{ timeout?: number, every?: number, label?: string }} [options]
 * @returns {Promise<any>}
 */
export async function waitFor(cdp, expression, { timeout = 120_000, every = 250, label = expression } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await cdp.eval(expression);
    } catch {}
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(every);
  }
}
