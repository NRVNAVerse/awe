// @ts-check
// Mobile touch-input regression for THE NRVNAVerse, against the real production bundle.
//
//   pnpm --filter the-nrvnaverse build          # once, or after any app / engine change
//   pnpm --filter the-nrvnaverse browser:touch  # starts `next start`, drives headless Chrome over raw CDP
//
// No dependencies: Node's built-in fetch / WebSocket and an installed Chrome (CHROME_PATH overrides the
// default location). Set BASE_URL to test an already-running server instead of starting one.
// Results are written as JSON to OUT_DIR (default: the OS temp dir), never into the repository.
// Exit code 0 = every check passed, 1 = a check failed, 2 = the environment is missing something.
//
// Checks (post-M0 input hardening; see docs/NRVNAVERSE_SPATIAL_RUNTIME.md §16):
//   A  joystick owner survives look-finger replacement (mobile UA, 390x844): finger A holds the stick,
//      finger B lands / drags / lifts on the canvas six times (one cycle cancelled), a third finger
//      tries to steal the stick; then a real touchcancel of everything cleans up both surfaces.
//   B  touch look direction is the same under a desktop UA as under a mobile UA (no double inversion).
//      Magnitude is NOT compared: the UA-derived touch magnitude difference is a known open AWE issue.
//   C  jump button: only the finger that pressed it can release it, while other touches are active.
//   D  existing contract smoke: canvas / aspect / orientation, directory + touch controls,
//      Hub -> Cannabis gateRequired with zero cannabis chunk requests.
//
// The stick is held BACKWARD in check A: the Hub spawn faces the gated Cannabis portal 11 m ahead,
// and walking into it would start a travel in the middle of the check. Ownership does not depend
// on direction.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.PORT ?? 3300);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9335);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-touch");
const CHROME =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => fs.existsSync(p));

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const PHONE = { w: 390, h: 844, dpr: 3 };
const CANNABIS_ID = "dst_441dtdafq3e3ehjn";

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {...unknown} a */
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

/**
 * @typedef {{ label: string, ok: boolean, detail?: unknown }} Assertion
 * @typedef {{ assertions: Assertion[], [key: string]: unknown }} CheckResult
 * @typedef {{ startedAt: string, finishedAt?: string, checks: Record<string, CheckResult>, failures: string[] }} Results
 * @typedef {{ ua: string, w: number, h: number, dpr: number, mobile?: boolean }} Profile
 * @typedef {{ x: number, y: number, id: number, radiusX: number, radiusY: number, force: number }} TouchPoint
 * @typedef {{ x: number, y: number, z: number, camAz: number, camY: number }} AvatarProbe
 * @typedef {import("node:child_process").ChildProcess} ChildProcess
 */

// ------------------------------------------------------------------------------------------ results
/** @type {Results} */
const results = { startedAt: new Date().toISOString(), checks: {}, failures: [] };
fs.mkdirSync(OUT_DIR, { recursive: true });
const save = () => fs.writeFileSync(path.join(OUT_DIR, "touch-regression.json"), JSON.stringify(results, null, 2));
/**
 * Record one assertion (and log it); a failed one fails the run.
 * @param {string} check
 * @param {string} label
 * @param {unknown} ok
 * @param {unknown} [detail]
 */
function expect(check, label, ok, detail) {
  const entry = { label, ok: !!ok, ...(detail === undefined ? {} : { detail }) };
  (results.checks[check] ??= { assertions: [] }).assertions.push(entry);
  if (!ok) results.failures.push(`${check}: ${label}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  log(ok ? "  ok  " : "  FAIL", `${check}: ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  save();
}

// ------------------------------------------------------------------------------------------ CDP
class CDP {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, method: string }>} */
    this.pending = new Map();
    /** @type {Map<string, Array<(params: any) => void>>} */
    this.handlers = new Map();
    /** Console errors and uncaught exceptions seen on the page. @type {string[]} */
    this.errors = [];
    /** URLs of every request the page made. @type {string[]} */
    this.requests = [];
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
   * Evaluate in the page and return the value.
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
function killTree(child) {
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
 * @param {string} chromePath
 * @returns {Promise<ChildProcess>}
 */
async function launchChrome(chromePath) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nrvna-touch-chrome-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--ignore-gpu-blocklist",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "about:blank",
    ],
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) return child;
    } catch {}
    await sleep(200);
  }
  killTree(child);
  throw new Error("Chrome did not expose the DevTools port");
}

/** @returns {Promise<{ base: string, child: ChildProcess | null }>} */
async function startServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL.replace(/\/$/, ""), child: null };
  if (!fs.existsSync(path.join(APP_DIR, ".next", "BUILD_ID"))) {
    console.error("No production build: run `pnpm --filter the-nrvnaverse build` first.");
    process.exit(2);
  }
  const nextBin = path.join(APP_DIR, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(PORT)], {
    cwd: APP_DIR,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base + "/")).ok) return { base, child };
    } catch {}
    await sleep(200);
  }
  killTree(child);
  throw new Error("next start did not answer on " + base);
}

/**
 * @param {Profile} profile
 * @returns {Promise<CDP>}
 */
async function newPage({ ua, w, h, dpr, mobile = true }) {
  const info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      cdp.errors.push(
        p.args.map((/** @type {{ value?: unknown, description?: string }} */ a) => a.value ?? a.description ?? "").join(" ").slice(0, 300),
      );
    }
  });
  cdp.on("Runtime.exceptionThrown", (p) =>
    cdp.errors.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").slice(0, 300)),
  );
  cdp.on("Network.requestWillBeSent", (p) => cdp.requests.push(p.request.url));
  // The engine classifies the device from the UA at module load, so the UA must be set before navigation.
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: ua });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: dpr,
    mobile,
    screenOrientation: { type: w > h ? "landscapePrimary" : "portraitPrimary", angle: w > h ? 90 : 0 },
  });
  return cdp;
}

/**
 * Poll an expression until it is truthy.
 * @param {CDP} cdp
 * @param {string} expression
 * @param {{ timeout?: number, every?: number, label?: string }} [options]
 * @returns {Promise<any>}
 */
async function waitFor(cdp, expression, { timeout = 120_000, every = 250, label = expression } = {}) {
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

const PLACED = `(() => { const ph = document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase"); return ph && ["ready", "arrived", "gateRequired"].includes(ph) && globalThis.__nrvnaverseInput ? ph : null; })()`;

/**
 * A fresh page, placed in the world, with pointercancel counters on the touch controls.
 * @param {string} base
 * @param {Profile} profile
 */
async function open(base, profile) {
  const cdp = await newPage(profile);
  await cdp.send("Page.navigate", { url: base + "/" });
  await waitFor(cdp, PLACED, { label: "world placed" });
  await sleep(600);
  // Count pointercancel on the touch controls from here on.
  await cdp.eval(`(() => { globalThis.__touchAudit = { joystickCancel: 0, jumpCancel: 0 };
    document.querySelector("[data-touch-joystick]")?.addEventListener("pointercancel", () => globalThis.__touchAudit.joystickCancel++);
    document.querySelector("[data-jump-button]")?.addEventListener("pointercancel", () => globalThis.__touchAudit.jumpCancel++);
    return true; })()`);
  return cdp;
}

// ------------------------------------------------------------------------------------------ probes
const INPUT = `globalThis.__nrvnaverseInput.touch()`;
const AVATAR = `(() => { const p = globalThis.$space?.components.byId("player"); const c = globalThis.$cam?.current; if (!p || !c) return null;
  return { x: p.position.x, y: p.position.y, z: p.position.z, camAz: Math.atan2(c.position.x - p.position.x, c.position.z - p.position.z), camY: c.position.y - p.position.y }; })()`;
const CONTROLS = `(() => { const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
  const stick = r(document.querySelector("[data-touch-joystick]")); const thumb = r(document.querySelector("[data-touch-joystick-thumb]"));
  return { stick, jump: r(document.querySelector("[data-jump-button]")), thumbOffset: stick && thumb ? { x: thumb.cx - stick.cx, y: thumb.cy - stick.cy } : null }; })()`;
const AUDIT = `globalThis.__touchAudit`;

/**
 * @param {number} x
 * @param {number} y
 * @param {number} id
 * @returns {TouchPoint}
 */
const tp = (x, y, id) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 4, radiusY: 4, force: 1 });
/**
 * Every touchStart / touchMove lists all fingers that are down; touchEnd lists the fingers lifting.
 * @param {CDP} cdp
 * @param {"touchStart" | "touchMove" | "touchEnd" | "touchCancel"} type
 * @param {TouchPoint[]} points
 */
const touch = (cdp, type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
/** @param {number} a */
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * @param {number} v
 * @param {number} [d]
 */
const round = (v, d = 3) => +v.toFixed(d);
/**
 * Horizontal distance between two avatar probes.
 * @param {AvatarProbe} a
 * @param {AvatarProbe} b
 */
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------------------------------ check A
/** @param {string} base */
async function checkA(base) {
  const C = "A-joystick-survives-look-replacement";
  const cdp = await open(base, { ua: MOBILE_UA, ...PHONE });
  const ctl = await cdp.eval(CONTROLS);
  expect(C, "joystick and jump rendered on the phone", ctl.stick && ctl.jump);
  const r = ctl.stick.w / 2 - (ctl.stick.w === 88 ? 16 : ctl.stick.w === 96 ? 18 : 20);
  const A = { id: 1, x: ctl.stick.cx, y: ctl.stick.cy };
  const held = () => tp(A.x, A.y, A.id);

  // Finger A presses and pulls the stick fully backward (screen down), then stays.
  await touch(cdp, "touchStart", [held()]);
  await sleep(40);
  for (let i = 1; i <= 3; i++) {
    A.y = ctl.stick.cy + (r * 1.3 * i) / 3;
    await touch(cdp, "touchMove", [held()]);
    await sleep(30);
  }
  await sleep(250);
  const base0 = await cdp.eval(INPUT);
  const thumb0 = (await cdp.eval(CONTROLS)).thumbOffset;
  expect(C, "A owns the stick: backward vector published", base0.joystick.y < -0.95, base0.joystick);
  expect(C, "A's thumb is deflected", thumb0.y > r * 0.9, thumb0);

  const canvasX = PHONE.w * 0.62;
  const canvasY = PHONE.h * 0.42;
  expect(C, "look point is on the canvas", (await cdp.eval(`document.elementFromPoint(${canvasX}, ${canvasY})?.id`)) === "game-canvas");

  /** @type {Array<Record<string, unknown>>} */
  const cycles = [];
  let prev = await cdp.eval(AVATAR);
  for (let cycle = 0; cycle < 6; cycle++) {
    const B = 10 + cycle;
    const dir = cycle % 2 === 0 ? 1 : -1; // alternate so the walk stays clear of the portals
    const cancel = cycle === 3;
    const before = await cdp.eval(AVATAR);

    await touch(cdp, "touchStart", [held(), tp(canvasX, canvasY, B)]);
    await sleep(40);
    const onPlace = await cdp.eval(INPUT);
    for (let i = 1; i <= 6; i++) {
      await touch(cdp, "touchMove", [held(), tp(canvasX + dir * i * 8, canvasY + i * 2, B)]);
      await sleep(35);
    }
    await sleep(80);
    const dragged = await cdp.eval(AVATAR);
    const whileDrag = await cdp.eval(INPUT);
    const thumbDrag = (await cdp.eval(CONTROLS)).thumbOffset;

    if (cancel) {
      // CDP can only cancel every touch at once, so cancel B the way the browser would deliver it
      // to the canvas: a touchcancel carrying B in changedTouches (A is untouched).
      await cdp.eval(`(() => { const c = document.getElementById("game-canvas"); const t = new Touch({ identifier: ${B}, target: c, clientX: ${canvasX + dir * 48}, clientY: ${canvasY + 12} });
        c.dispatchEvent(new TouchEvent("touchcancel", { changedTouches: [t], touches: [], bubbles: true, cancelable: true })); return true; })()`);
      await sleep(80);
      const afterCancel = await cdp.eval(INPUT);
      // Let Chrome's own touch sequence for B finish (the canvas no longer tracks it).
      await touch(cdp, "touchEnd", [tp(canvasX + dir * 48, canvasY + 12, B)]);
      cycles.push({ cycle, cancel, afterCancel });
    } else {
      await touch(cdp, "touchEnd", [tp(canvasX + dir * 48, canvasY + 12, B)]);
    }
    await sleep(120);
    const afterLift = await cdp.eval(INPUT);
    const thumbAfter = (await cdp.eval(CONTROLS)).thumbOffset;
    const now = await cdp.eval(AVATAR);
    const yaw = wrapAngle(dragged.camAz - before.camAz);
    cycles.push({
      cycle,
      finger: B,
      dir,
      cancel,
      onPlace: { touchCount: onPlace.touchCount, lookTouchId: onPlace.lookTouchId, joystickY: round(onPlace.joystick.y) },
      whileDrag: { joystickY: round(whileDrag.joystick.y), thumbY: round(thumbDrag.y, 1) },
      afterLift: { touchCount: afterLift.touchCount, isTouching: afterLift.isTouching, lookTouchId: afterLift.lookTouchId, joystickY: round(afterLift.joystick.y), thumbY: round(thumbAfter.y, 1) },
      yaw: round(yaw, 4),
      moved: round(dist(prev, now), 2),
    });
    expect(C, `cycle ${cycle}: B (${B}) claims look on landing`, onPlace.lookTouchId === B && onPlace.touchCount === 1, onPlace);
    expect(C, `cycle ${cycle}: B's drag rotates the camera`, Math.abs(yaw) > 0.05, round(yaw, 4));
    expect(C, `cycle ${cycle}: movement vector held while B drags`, whileDrag.joystick.y < -0.95, whileDrag.joystick);
    expect(C, `cycle ${cycle}: thumb never recentres while A holds`, thumbDrag.y > r * 0.9 && thumbAfter.y > r * 0.9, { thumbDrag, thumbAfter });
    expect(C, `cycle ${cycle}: canvas released after B ${cancel ? "cancel" : "lift"}`, afterLift.touchCount === 0 && !afterLift.isTouching && afterLift.lookTouchId === null, afterLift);
    expect(C, `cycle ${cycle}: movement vector unchanged after B leaves`, afterLift.joystick.y < -0.95, afterLift.joystick);
    expect(C, `cycle ${cycle}: avatar kept moving`, dist(prev, now) > 0.5, round(dist(prev, now), 2));
    prev = now;
  }

  // A third finger tries to steal the stick while A holds it: press on the rim, drag away, lift.
  const stealBefore = await cdp.eval(INPUT);
  await touch(cdp, "touchStart", [held(), tp(ctl.stick.cx + r, ctl.stick.cy - 4, 30)]);
  await sleep(40);
  for (let i = 1; i <= 4; i++) {
    await touch(cdp, "touchMove", [held(), tp(ctl.stick.cx + r + i * 40, ctl.stick.cy - 4 - i * 60, 30)]);
    await sleep(35);
  }
  const duringSteal = await cdp.eval(INPUT);
  const thumbSteal = (await cdp.eval(CONTROLS)).thumbOffset;
  await touch(cdp, "touchEnd", [tp(ctl.stick.cx + r + 160, ctl.stick.cy - 244, 30)]);
  await sleep(150);
  const afterSteal = await cdp.eval(INPUT);
  const thumbAfterSteal = (await cdp.eval(CONTROLS)).thumbOffset;
  expect(C, "steal: vector unchanged while the third finger drags", Math.abs(duringSteal.joystick.x - stealBefore.joystick.x) < 1e-6 && Math.abs(duringSteal.joystick.y - stealBefore.joystick.y) < 1e-6, { before: stealBefore.joystick, during: duringSteal.joystick });
  expect(C, "steal: thumb stays with A", Math.abs(thumbSteal.y - thumb0.y) < 1 && Math.abs(thumbSteal.x - thumb0.x) < 1, thumbSteal);
  expect(C, "steal: lifting the third finger does not reset the stick", afterSteal.joystick.y < -0.95 && thumbAfterSteal.y > r * 0.9, { vector: afterSteal.joystick, thumb: thumbAfterSteal });
  expect(C, "steal: the stick's touches never reached the canvas", afterSteal.touchCount === 0 && afterSteal.lookTouchId === null, afterSteal);

  const audit = await cdp.eval(AUDIT);
  expect(C, "no joystick pointercancel during the sequence", audit.joystickCancel === 0, audit);

  // Finally a real touchcancel of every finger: both surfaces must clean up.
  await touch(cdp, "touchStart", [held(), tp(canvasX, canvasY, 40)]);
  await sleep(60);
  await touch(cdp, "touchCancel", []);
  await sleep(250);
  const afterAll = await cdp.eval(INPUT);
  const thumbFinal = (await cdp.eval(CONTROLS)).thumbOffset;
  const s1 = await cdp.eval(AVATAR);
  await sleep(500);
  const s2 = await cdp.eval(AVATAR);
  expect(C, "cancel-all: joystick recentred and neutral", afterAll.joystick.x === 0 && afterAll.joystick.y === 0 && Math.abs(thumbFinal.x) < 1 && Math.abs(thumbFinal.y) < 1, { vector: afterAll.joystick, thumbFinal });
  expect(C, "cancel-all: canvas released", afterAll.touchCount === 0 && !afterAll.isTouching && afterAll.lookTouchId === null, afterAll);
  expect(C, "cancel-all: avatar stops", dist(s1, s2) < 0.3, round(dist(s1, s2), 3));
  expect(C, "no console errors", cdp.errors.length === 0, cdp.errors);
  results.checks[C].cycles = cycles;
  save();
  cdp.close();
}

// ------------------------------------------------------------------------------------------ check B
/**
 * Four canvas drags (right, left, down, up) and the camera turn each produced.
 * @param {string} base
 * @param {string} ua
 */
async function lookDirections(base, ua) {
  const cdp = await open(base, { ua, ...PHONE });
  const x0 = PHONE.w * 0.62;
  const y0 = PHONE.h * 0.42;
  /**
   * @param {number} dx
   * @param {number} dy
   * @param {number} id
   */
  const drag = async (dx, dy, id) => {
    const before = await cdp.eval(AVATAR);
    await touch(cdp, "touchStart", [tp(x0, y0, id)]);
    await sleep(40);
    for (let i = 1; i <= 6; i++) {
      await touch(cdp, "touchMove", [tp(x0 + (dx * i) / 6, y0 + (dy * i) / 6, id)]);
      await sleep(35);
    }
    await sleep(120);
    const after = await cdp.eval(AVATAR);
    await touch(cdp, "touchEnd", [tp(x0 + dx, y0 + dy, id)]);
    await sleep(250);
    return { yaw: round(wrapAngle(after.camAz - before.camAz), 4), camY: round(after.camY - before.camY, 4) };
  };
  const right = await drag(60, 0, 1);
  const left = await drag(-60, 0, 2);
  const down = await drag(0, 60, 3);
  const up = await drag(0, -60, 4);
  const input = await cdp.eval(INPUT);
  const errors = cdp.errors;
  cdp.close();
  return { right, left, down, up, released: input, errors };
}

/** @param {string} base */
async function checkB(base) {
  const C = "B-desktop-ua-touch-direction";
  const mobile = await lookDirections(base, MOBILE_UA);
  const desktop = await lookDirections(base, DESKTOP_UA);
  results.checks[C] = { assertions: [], mobile, desktop };
  for (const [name, m] of /** @type {Array<[string, typeof mobile]>} */ ([
    ["mobile UA", mobile],
    ["desktop UA", desktop],
  ])) {
    expect(C, `${name}: horizontal drags turn the camera both ways`, Math.abs(m.right.yaw) > 0.02 && Math.sign(m.right.yaw) === -Math.sign(m.left.yaw), { right: m.right.yaw, left: m.left.yaw });
    expect(C, `${name}: vertical drags tilt the camera both ways`, Math.abs(m.down.camY) > 0.01 && Math.sign(m.down.camY) === -Math.sign(m.up.camY), { down: m.down.camY, up: m.up.camY });
    expect(C, `${name}: canvas released afterwards`, m.released.touchCount === 0 && m.released.lookTouchId === null, m.released);
    expect(C, `${name}: no console errors`, m.errors.length === 0, m.errors);
  }
  expect(C, "horizontal direction matches between desktop and mobile UA", Math.sign(desktop.right.yaw) === Math.sign(mobile.right.yaw), { mobile: mobile.right.yaw, desktop: desktop.right.yaw });
  expect(C, "vertical direction matches between desktop and mobile UA", Math.sign(desktop.down.camY) === Math.sign(mobile.down.camY), { mobile: mobile.down.camY, desktop: desktop.down.camY });
  results.checks[C].magnitudeNote = "Not compared: UA-derived touch magnitude differs by design until the AWE-library handoff lands.";
  save();
}

// ------------------------------------------------------------------------------------------ check C
/** @param {string} base */
async function checkC(base) {
  const C = "C-jump-ownership";
  const cdp = await open(base, { ua: MOBILE_UA, ...PHONE });
  const ctl = await cdp.eval(CONTROLS);
  const J = tp(ctl.jump.cx, ctl.jump.cy, 50);
  const look = tp(PHONE.w * 0.55, PHONE.h * 0.4, 51);

  // Another touch is already active on the canvas.
  await touch(cdp, "touchStart", [look]);
  await sleep(60);
  const y0 = (await cdp.eval(AVATAR)).y;
  await touch(cdp, "touchStart", [look, J]);
  await sleep(80);
  const pressed = await cdp.eval(INPUT);
  expect(C, "jump owner press holds jump", pressed.jumpHeld === true, pressed);

  // A second finger lands on the jump button and lifts: it must not release the owner's jump.
  const K = tp(ctl.jump.cx + 6, ctl.jump.cy - 6, 52);
  await touch(cdp, "touchStart", [look, J, K]);
  await sleep(60);
  await touch(cdp, "touchEnd", [K]);
  await sleep(80);
  const afterOther = await cdp.eval(INPUT);
  expect(C, "another pointer lifting off the button does not release jump", afterOther.jumpHeld === true, afterOther);

  // The unrelated canvas touch ends: jump still held.
  await touch(cdp, "touchEnd", [look]);
  await sleep(80);
  const afterLook = await cdp.eval(INPUT);
  expect(C, "an unrelated touch ending does not release jump", afterLook.jumpHeld === true, afterLook);

  await touch(cdp, "touchEnd", [J]);
  await sleep(100);
  const released = await cdp.eval(INPUT);
  expect(C, "the owner lifting releases jump", released.jumpHeld === false, released);
  await sleep(1200);

  // Jump still works after the multitouch sequence.
  const J2 = tp(ctl.jump.cx, ctl.jump.cy, 53);
  const ground = (await cdp.eval(AVATAR)).y;
  await touch(cdp, "touchStart", [J2]);
  let peak = ground;
  for (let i = 0; i < 10; i++) {
    await sleep(50);
    peak = Math.max(peak, (await cdp.eval(AVATAR)).y);
  }
  await touch(cdp, "touchEnd", [J2]);
  await sleep(1200);
  const landed = (await cdp.eval(AVATAR)).y;
  const end = await cdp.eval(INPUT);
  expect(C, "jump still lifts the avatar afterwards", peak - ground > 1, { ground: round(ground), peak: round(peak), y0: round(y0) });
  expect(C, "jump released and avatar landed", end.jumpHeld === false && Math.abs(landed - ground) < 0.5, { jumpHeld: end.jumpHeld, landed: round(landed) });
  const audit = await cdp.eval(AUDIT);
  expect(C, "no jump pointercancel", audit.jumpCancel === 0, audit);
  expect(C, "no console errors", cdp.errors.length === 0, cdp.errors);
  save();
  cdp.close();
}

// ------------------------------------------------------------------------------------------ check D
/** @param {string} base */
async function checkD(base) {
  const C = "D-existing-contract";
  const cdp = await open(base, { ua: MOBILE_UA, ...PHONE });
  const layout = `(() => { const c = document.getElementById("game-canvas"); const cam = globalThis.$cam?.current; const r = c.getBoundingClientRect();
    return { inner: [innerWidth, innerHeight], canvasCss: [Math.round(r.width), Math.round(r.height)], canvasTouchAction: getComputedStyle(c).touchAction, containerTouchAction: getComputedStyle(document.getElementById("canvas-container")).touchAction,
      camAspect: cam ? +cam.aspect.toFixed(4) : null, viewportAspect: +(innerWidth / innerHeight).toFixed(4), aside: !!document.getElementById("nrvna-panel"),
      joystick: !!document.querySelector("[data-touch-joystick]"), jump: !!document.querySelector("[data-jump-button]") }; })()`;
  const portrait = await cdp.eval(layout);
  expect(C, "portrait: canvas fills the viewport and camera aspect matches", portrait.canvasCss[0] === portrait.inner[0] && portrait.canvasCss[1] === portrait.inner[1] && Math.abs(portrait.camAspect - portrait.viewportAspect) < 0.01, portrait);
  expect(C, "render canvas and its container are touch-action: none", portrait.canvasTouchAction === "none" && portrait.containerTouchAction === "none", portrait);
  expect(C, "directory closed by default; joystick and jump shown", !portrait.aside && portrait.joystick && portrait.jump, portrait);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: PHONE.h, height: PHONE.w, deviceScaleFactor: PHONE.dpr, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
  await sleep(600);
  const landscape = await cdp.eval(layout);
  expect(C, "landscape: canvas and camera aspect follow the rotation", landscape.canvasCss[0] === landscape.inner[0] && Math.abs(landscape.camAspect - landscape.viewportAspect) < 0.01, landscape);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: PHONE.w, height: PHONE.h, deviceScaleFactor: PHONE.dpr, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } });
  await sleep(600);

  /** @param {string} selector */
  const tapAt = async (selector) => {
    const p = await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + Math.min(12, r.width / 2), y: r.top + r.height / 2 }; })()`);
    if (!p) throw new Error("not found: " + selector);
    await touch(cdp, "touchStart", [tp(p.x, p.y, 60)]);
    await sleep(60);
    await touch(cdp, "touchEnd", [tp(p.x, p.y, 60)]);
    await sleep(300);
  };
  await tapAt('[data-panel-toggle="open"]');
  const opened = await cdp.eval(layout);
  expect(C, "directory opens by tap and hides the touch controls", opened.aside && !opened.joystick && !opened.jump, opened);

  cdp.requests.length = 0;
  await tapAt(`a[data-destination-id="${CANNABIS_ID}"]`);
  const banner = await waitFor(cdp, `document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? null`, { timeout: 20_000, label: "travel banner" });
  expect(C, "Hub -> Cannabis ends in gateRequired", banner === "gateRequired", banner);
  const cannabisRequests = cdp.requests.filter((u) => /cannabis/i.test(u));
  expect(C, "zero cannabis chunk requests", cannabisRequests.length === 0, cannabisRequests);
  const ok = await cdp.eval(`!!document.querySelector("[data-phase] button")`);
  if (ok) await tapAt("[data-phase] button");
  await tapAt('[data-panel-toggle="close"]');
  const closed = await cdp.eval(layout);
  expect(C, "directory closes by tap and the touch controls return", !closed.aside && closed.joystick && closed.jump, closed);
  expect(C, "no console errors", cdp.errors.length === 0, cdp.errors);
  save();
  cdp.close();
}

// ------------------------------------------------------------------------------------------ main
if (!CHROME) {
  console.error("Chrome not found: set CHROME_PATH.");
  process.exit(2);
}
/** @type {{ base: string, child: ChildProcess | null } | null} */
let server = null;
/** @type {ChildProcess | null} */
let chrome = null;
try {
  server = await startServer();
  log("server", server.base);
  chrome = await launchChrome(CHROME);
  const only = (process.env.CHECKS ?? "A,B,C,D").split(",");
  for (const [key, fn] of /** @type {Array<[string, (base: string) => Promise<void>]>} */ ([
    ["A", checkA],
    ["B", checkB],
    ["C", checkC],
    ["D", checkD],
  ])) {
    if (!only.includes(key)) continue;
    log("check", key);
    try {
      await fn(server.base);
    } catch (e) {
      expect(key, "check ran to completion", false, String(e instanceof Error ? e.stack : e).slice(0, 500));
    }
  }
} finally {
  killTree(chrome);
  killTree(server?.child);
}
results.finishedAt = new Date().toISOString();
save();
log(results.failures.length ? `FAILED (${results.failures.length})` : "PASSED", "->", path.join(OUT_DIR, "touch-regression.json"));
for (const f of results.failures) log("  -", f);
process.exitCode = results.failures.length ? 1 : 0;
