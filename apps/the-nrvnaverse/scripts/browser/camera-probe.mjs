// @ts-check
// First- / third-person camera probe for THE NRVNAVerse (M3 Mission A), against the real bundle.
//
//   pnpm --filter the-nrvnaverse build           # once, or after any app / engine change
//   pnpm --filter the-nrvnaverse browser:camera  # starts `next start`, drives headless Chrome over raw CDP
//
// BASE_URL reuses a running server (e.g. `next dev`); results go to OUT_DIR (default: OS temp dir),
// never into the repository. Exit 0 = every check passed, 1 = a check failed, 2 = environment missing.
//
// Real input throughout (CDP key / touch events), read back through the read-only snapshots
// `window.__nrvnaverseCamera` and `window.__nrvnaverseInput`:
//   D  desktop 1280×800: third person by default (avatar drawn, orbit rig live, camera behind);
//      V → first person (avatar hidden, eye rig live, camera at the eye, view direction kept);
//      walking in first person; V → third person (dolly back out, direction kept); wheel zoom ignored in
//      first person; settings panel: arrow keys on a slider change the slider and NOT the avatar,
//      Escape closes and returns focus; reload keeps view + sensitivity; Reset restores defaults;
//      directory travel Hub → Music in first person keeps the view and re-frames at the spawn.
//   M  phone 390×844 (mobile UA, touch): the HUD offers the view toggle and settings; the open panel
//      hides joystick and Jump; touch-look sensitivity 2.0 turns the camera ≈ 2× as far as 1.0 for the
//      same drag; first person by tap; touch look and the joystick still work in first person.
//
// Mouse-look sensitivity cannot be measured headless (no pointer lock — see the runtime doc); it is
// the same multiply-before-the-rig path as touch (`scaledLook`, unit-tested).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHROME, buildFreshness, killTree, launchChrome, log, removeDir, sleep, startServer, waitFor, CDP } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3320);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9337);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-camera");
const MUSIC_ID = "dst_gm3xs4a3tws7bgh3";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

/** @typedef {{ label: string, ok: boolean, detail?: unknown }} Assertion */
const results = /** @type {{ startedAt: string, finishedAt?: string, build?: unknown, checks: Record<string, Assertion[]>, failures: string[], notes: Record<string, unknown> }} */ ({
  startedAt: new Date().toISOString(),
  checks: {},
  failures: [],
  notes: {},
});
fs.mkdirSync(OUT_DIR, { recursive: true });
const save = () => fs.writeFileSync(path.join(OUT_DIR, "camera-probe.json"), JSON.stringify(results, null, 2));
/**
 * @param {string} check
 * @param {string} label
 * @param {unknown} ok
 * @param {unknown} [detail]
 */
function expect(check, label, ok, detail) {
  (results.checks[check] ??= []).push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) results.failures.push(`${check}: ${label}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  log(ok ? "  ok  " : "  FAIL", `${check}: ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  save();
}

const PLACED = `(() => { const ph = document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase"); const cam = globalThis.__nrvnaverseCamera?.snapshot(); return ph && ["ready", "arrived"].includes(ph) && cam && cam.active ? ph : null; })()`;
const CAM = `globalThis.__nrvnaverseCamera.snapshot()`;
const INPUT = `globalThis.__nrvnaverseInput.touch()`;

/** @param {number} a */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** @param {number} v @param {number} [d] */
const round = (v, d = 3) => +v.toFixed(d);
/** @param {{x:number,y:number,z:number}} a @param {{x:number,y:number,z:number}} b */
const horiz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** Camera to avatar head distance. @param {any} s */
const camToHead = (s, height = 1.7) => Math.hypot(s.camera.x - s.avatar.x, s.camera.y - (s.avatar.y + height), s.camera.z - s.avatar.z);

/**
 * @param {CDP} cdp
 * @param {string} code
 * @param {string} key
 * @param {number} vk
 * @param {number} [holdMs]
 */
async function key(cdp, code, key, vk, holdMs = 60) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
  await sleep(holdMs);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
}
const pressV = (/** @type {CDP} */ cdp) => key(cdp, "KeyV", "v", 86);

/** Evidence screenshot into OUT_DIR. @param {CDP} cdp @param {string} name */
async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
}

/** Element centre in CSS px, or null. @param {CDP} cdp @param {string} selector */
const centre = (cdp, selector) =>
  cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);

/** A real mouse click at an element's centre. @param {CDP} cdp @param {string} selector */
async function click(cdp, selector) {
  const c = await centre(cdp, selector);
  if (!c) throw new Error(`no element ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 });
  await sleep(150);
}

/** A real tap at an element's centre. @param {CDP} cdp @param {string} selector */
async function tap(cdp, selector) {
  const c = await centre(cdp, selector);
  if (!c) throw new Error(`no element ${selector}`);
  const p = { x: Math.round(c.x), y: Math.round(c.y), id: 1, radiusX: 4, radiusY: 4, force: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await sleep(50);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(200);
}

/**
 * A fresh page with an emulated profile, storage cleared for the origin, placed in the world.
 * @param {string} base
 * @param {{ w: number, h: number, dpr: number, mobile: boolean, ua?: string }} profile
 * @param {{ clear?: boolean, query?: string }} [options]
 */
async function open(base, profile, { clear = true, query = "" } = {}) {
  const info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (p) => cdp.errors.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text ?? "").slice(0, 300)));
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") cdp.errors.push(p.args.map((/** @type {any} */ a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  });
  if (profile.ua) await cdp.send("Emulation.setUserAgentOverride", { userAgent: profile.ua });
  if (profile.mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: profile.w, height: profile.h, deviceScaleFactor: profile.dpr, mobile: profile.mobile });
  if (clear) {
    await cdp.send("Page.navigate", { url: base + "/api/health" });
    await sleep(500);
    await cdp.eval(`(() => { try { localStorage.clear(); } catch {} return true; })()`);
  }
  await cdp.send("Page.navigate", { url: base + "/" + query });
  await waitFor(cdp, PLACED, { label: "world placed with live camera" });
  await sleep(1200); // the orbit settles behind the avatar
  return cdp;
}

// ------------------------------------------------------------------------------------------ D
/** @param {string} base */
async function desktop(base) {
  const C = "D-desktop";
  const profile = { w: 1280, h: 800, dpr: 1, mobile: false };
  let cdp = await open(base, profile);
  const t0 = await cdp.eval(CAM);
  results.notes.desktopStart = t0;
  expect(C, "third person by default: orbit rig live, eye rig off, avatar drawn", t0.view === "third" && t0.orbitActive && !t0.eyeActive && t0.avatarVisible === true, t0);
  expect(C, "the orbit camera sits behind / around the avatar (≤ zoom, > 1 m)", horiz(t0.camera, t0.avatar) > 1 && camToHead(t0) <= t0.orbitZoom + 0.6, { horiz: round(horiz(t0.camera, t0.avatar), 2), zoom: t0.orbitZoom });
  await shot(cdp, "desktop-third-default");
  expect(C, "the HUD shows the view toggle and settings button", (await cdp.eval(`!!document.querySelector("[data-camera-view-toggle=third]") && !!document.querySelector("[data-camera-settings-toggle=open]")`)) === true);

  // V → first person.
  await pressV(cdp);
  await sleep(400);
  const f1 = await cdp.eval(CAM);
  await shot(cdp, "desktop-first");
  expect(C, "V → first person: eye rig live, orbit off, avatar hidden", f1.view === "first" && f1.eyeActive && !f1.orbitActive && f1.avatarVisible === false, f1);
  expect(C, "the camera is at the eye (≤ 0.15 m horizontally, 1–2.2 m above the feet)", horiz(f1.camera, f1.avatar) < 0.15 && f1.camera.y - f1.avatar.y > 1 && f1.camera.y - f1.avatar.y < 2.2, { horiz: round(horiz(f1.camera, f1.avatar)), eye: round(f1.camera.y - f1.avatar.y, 2) });
  expect(C, "the view direction is kept across the switch (|Δyaw| < 0.05 rad)", Math.abs(wrap(f1.yaw - t0.yaw)) < 0.05, { before: round(t0.yaw), after: round(f1.yaw) });
  expect(C, "the HUD toggle reflects first person", (await cdp.eval(`document.querySelector("[data-camera-view-toggle]")?.getAttribute("data-camera-view-toggle")`)) === "first");

  // Walking in first person (backward: the Hub spawn faces the gated portal ahead).
  await key(cdp, "KeyS", "s", 83, 600);
  await sleep(400);
  const f2 = await cdp.eval(CAM);
  const fwd = { x: -Math.sin(f1.yaw), z: -Math.cos(f1.yaw) };
  const moved = { x: f2.avatar.x - f1.avatar.x, z: f2.avatar.z - f1.avatar.z };
  const along = moved.x * fwd.x + moved.z * fwd.z;
  expect(C, "S walks backward relative to the first-person view (≥ 2 m, opposite the look direction)", along < -2, { along: round(along, 2), moved: round(Math.hypot(moved.x, moved.z), 2) });
  expect(C, "the eye follows the avatar while walking", horiz(f2.camera, f2.avatar) < 0.3, round(horiz(f2.camera, f2.avatar)));

  // Wheel in first person: nothing changes.
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: 400 });
  await sleep(300);
  const f3 = await cdp.eval(CAM);
  expect(C, "wheel zoom is ignored in first person", f3.view === "first" && horiz(f3.camera, f3.avatar) < 0.3 && f3.orbitZoom === f2.orbitZoom, { horiz: round(horiz(f3.camera, f3.avatar)), zoom: f3.orbitZoom });

  // V → third person: dolly back out, direction kept.
  await pressV(cdp);
  await sleep(80);
  const t1a = await cdp.eval(CAM);
  await sleep(1200);
  const t1 = await cdp.eval(CAM);
  expect(C, "V → third person: orbit live, eye off, avatar drawn", t1.view === "third" && t1.orbitActive && !t1.eyeActive && t1.avatarVisible === true, t1);
  expect(C, "the orbit returns to its distance (≥ 4 m within 1.2 s)", camToHead(t1) > 4, { at80ms: round(camToHead(t1a), 2), at1300ms: round(camToHead(t1), 2), zoom: t1.orbitZoom });
  expect(C, "the view direction is kept on the way back (|Δyaw| < 0.1 rad, |Δpitch| < 0.1 rad)", Math.abs(wrap(t1.yaw - f3.yaw)) < 0.1 && Math.abs(t1.pitch - f3.pitch) < 0.1, { before: [round(f3.yaw), round(f3.pitch)], after: [round(t1.yaw), round(t1.pitch)] });

  // Settings panel: open, focus, keys stay in the panel.
  await click(cdp, "[data-camera-settings-toggle]");
  expect(C, "Camera settings opens the panel (aria-expanded)", (await cdp.eval(`!!document.querySelector("[data-camera-panel]") && document.querySelector("[data-camera-settings-toggle]").getAttribute("aria-expanded") === "true"`)) === true);
  expect(C, "desktop shows the mouse slider, not the touch slider", (await cdp.eval(`[!!document.querySelector("[data-camera-sensitivity=mouse]"), !!document.querySelector("[data-camera-sensitivity=touch]")].join()`)) === "true,false");
  await shot(cdp, "desktop-settings");
  await cdp.eval(`document.querySelector("[data-camera-sensitivity=mouse]").focus()`);
  const beforeKeys = await cdp.eval(CAM);
  for (let i = 0; i < 6; i++) await key(cdp, "ArrowRight", "ArrowRight", 39, 40);
  await key(cdp, "KeyW", "w", 87, 300); // a movement key typed into the panel
  await sleep(400);
  const afterKeys = await cdp.eval(CAM);
  const shown = await cdp.eval(`document.querySelector("[data-camera-sensitivity-value=mouse]")?.textContent`);
  expect(C, "arrow keys on the slider raise mouse sensitivity to 1.6×", shown === "1.6×", shown);
  expect(C, "keys typed in the panel never move the avatar (< 0.05 m)", horiz(afterKeys.avatar, beforeKeys.avatar) < 0.05, round(horiz(afterKeys.avatar, beforeKeys.avatar)));
  await key(cdp, "Escape", "Escape", 27);
  await sleep(200);
  expect(C, "Escape closes the panel and returns focus to its button", (await cdp.eval(`!document.querySelector("[data-camera-panel]") && document.activeElement?.hasAttribute("data-camera-settings-toggle")`)) === true);
  await cdp.eval(`document.activeElement?.blur()`);

  // Persistence: first person + 1.6× survive a reload.
  await pressV(cdp);
  await sleep(300);
  const stored = await cdp.eval(`localStorage.getItem("nrvnaverse.camera.v1")`);
  expect(C, "preferences persisted (versioned key)", stored && JSON.parse(stored).v === 1 && JSON.parse(stored).view === "first" && JSON.parse(stored).mouse === 1.6, stored);
  cdp.close();
  cdp = await open(base, profile, { clear: false });
  const r1 = await cdp.eval(CAM);
  expect(C, "after reload: first person from the first frame, avatar hidden", r1.view === "first" && r1.eyeActive && r1.avatarVisible === false && horiz(r1.camera, r1.avatar) < 0.15, r1);
  expect(C, "after reload: the eye faces the way the orbit frames the spawn (yaw of the default third-person view)", Math.abs(wrap(r1.yaw - t0.yaw)) < 0.05 && Math.abs(r1.pitch) < 0.05, { thirdPersonSpawnYaw: round(t0.yaw), firstPersonSpawnYaw: round(r1.yaw) });
  await click(cdp, "[data-camera-settings-toggle]");
  expect(C, "after reload: the slider shows 1.6×", (await cdp.eval(`document.querySelector("[data-camera-sensitivity-value=mouse]")?.textContent`)) === "1.6×");

  // Directory travel in first person keeps the view and re-frames at the spawn.
  await click(cdp, "[data-camera-done]");
  const startAvatar = (await cdp.eval(CAM)).avatar;
  await cdp.eval(`(() => { const open = document.querySelector('[data-panel-toggle="open"]'); if (open) open.click(); return true; })()`);
  await sleep(300);
  await cdp.eval(`document.querySelector('a[data-destination-id="${MUSIC_ID}"]').click()`);
  const banner = await waitFor(cdp, `(() => { const p = document.querySelector("[data-phase]")?.getAttribute("data-phase"); return p && p !== "loadingChunk" ? p : null; })()`, { timeout: 30_000, every: 100, label: "travel outcome" });
  await sleep(800);
  const m1 = await cdp.eval(CAM);
  await shot(cdp, "desktop-first-music");
  expect(C, "Hub → Music travel arrives in first person, eye at the new spawn", banner === "arrived" && m1.view === "first" && m1.eyeActive && m1.avatarVisible === false && horiz(m1.camera, m1.avatar) < 0.15 && horiz(m1.avatar, startAvatar) > 10, { banner, view: m1.view, horiz: round(horiz(m1.camera, m1.avatar)) });

  // Reset to defaults.
  await click(cdp, "[data-camera-settings-toggle]");
  await click(cdp, "[data-camera-reset]");
  await sleep(1300);
  const d1 = await cdp.eval(CAM);
  const storedReset = await cdp.eval(`localStorage.getItem("nrvnaverse.camera.v1")`);
  expect(C, "Reset to defaults: third person, 1.0×, persisted", d1.view === "third" && d1.avatarVisible === true && d1.orbitActive && JSON.parse(storedReset).mouse === 1 && JSON.parse(storedReset).view === "third", { view: d1.view, storedReset });
  expect(C, "no page errors", cdp.errors.filter((e) => !/WrongDocumentError|pointer lock/i.test(e)).length === 0, cdp.errors.slice(0, 5));
  cdp.close();
}

// ------------------------------------------------------------------------------------------ M
/** @param {string} base */
async function mobile(base) {
  const C = "M-phone";
  const profile = { w: 390, h: 844, dpr: 3, mobile: true, ua: MOBILE_UA };
  const cdp = await open(base, profile);
  const s0 = await cdp.eval(CAM);
  await shot(cdp, "phone-third-default");
  expect(C, "third person by default on the phone", s0.view === "third" && s0.orbitActive && s0.avatarVisible === true, s0);
  expect(C, "joystick and Jump are shown while the panel is closed", (await cdp.eval(`!!document.querySelector("[data-touch-joystick]") && !!document.querySelector("[data-jump-button]")`)) === true);
  const hud = await cdp.eval(`(() => { const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    return { toggle: r("[data-camera-view-toggle]"), settings: r("[data-camera-settings-toggle]"), dir: r('[data-panel-toggle="open"]'), stick: r("[data-touch-joystick]"), jump: r("[data-jump-button]") }; })()`);
  results.notes.phoneHud = hud;
  const overlaps = (/** @type {any} */ a, /** @type {any} */ b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  expect(C, "HUD camera buttons do not overlap the directory toggle, joystick or Jump", !overlaps(hud.toggle, hud.dir) && !overlaps(hud.settings, hud.dir) && !overlaps(hud.settings, hud.stick) && !overlaps(hud.toggle, hud.jump), hud);

  // Measure a fixed canvas drag at 1.0×.
  const drag = async () => {
    const before = await cdp.eval(CAM);
    const x0 = 250, y0 = 360;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
    await sleep(40);
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + i * 6, y: y0, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
      await sleep(35);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(900); // let the orbit smoothing converge
    const after = await cdp.eval(CAM);
    return round(wrap(after.yaw - before.yaw), 4);
  };
  const yaw1 = await drag();
  expect(C, "touch drag turns the camera at 1.0×", Math.abs(yaw1) > 0.05, yaw1);

  // Settings by tap; the open panel hides joystick + Jump.
  await tap(cdp, "[data-camera-settings-toggle]");
  expect(C, "tapping Camera settings opens the panel", (await cdp.eval(`!!document.querySelector("[data-camera-panel]")`)) === true);
  expect(C, "the open panel hides joystick and Jump", (await cdp.eval(`!document.querySelector("[data-touch-joystick]") && !document.querySelector("[data-jump-button]")`)) === true);
  await shot(cdp, "phone-settings");
  expect(C, "the phone shows the touch slider", (await cdp.eval(`!!document.querySelector("[data-camera-sensitivity=touch]")`)) === true);
  results.notes.phoneShowsMouseSlider = await cdp.eval(`!!document.querySelector("[data-camera-sensitivity=mouse]")`);
  const panel = await cdp.eval(`(() => { const b = document.querySelector("[data-camera-panel]").getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, vw: innerWidth, vh: innerHeight }; })()`);
  expect(C, "the panel fits the phone viewport", panel.l >= 0 && panel.r <= panel.vw && panel.b <= panel.vh, panel);
  await cdp.eval(`document.querySelector("[data-camera-sensitivity=touch]").focus()`);
  for (let i = 0; i < 10; i++) await key(cdp, "ArrowRight", "ArrowRight", 39, 30);
  expect(C, "touch sensitivity set to 2.0×", (await cdp.eval(`document.querySelector("[data-camera-sensitivity-value=touch]")?.textContent`)) === "2.0×");
  await tap(cdp, "[data-camera-done]");
  expect(C, "Done closes the panel and the touch controls return", (await cdp.eval(`!document.querySelector("[data-camera-panel]") && !!document.querySelector("[data-touch-joystick]")`)) === true);
  const yaw2 = await drag();
  const ratio = round(yaw2 / yaw1, 2);
  expect(C, "the same drag turns ≈ 2× as far at 2.0× (ratio 1.7–2.3)", ratio > 1.7 && ratio < 2.3, { yaw1, yaw2, ratio });

  // First person by tap; touch look + joystick still work.
  await tap(cdp, "[data-camera-view-toggle]");
  await sleep(300);
  const f = await cdp.eval(CAM);
  await shot(cdp, "phone-first");
  expect(C, "tapping the view toggle → first person, avatar hidden", f.view === "first" && f.eyeActive && f.avatarVisible === false, f);
  const yawF = await drag();
  expect(C, "touch look turns the first-person camera", Math.abs(yawF) > 0.02, yawF);
  const stick = await centre(cdp, "[data-touch-joystick]");
  const place = await cdp.eval(`document.querySelector("[data-current-destination]")?.getAttribute("data-current-destination")`);
  const a = await cdp.eval(CAM);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: Math.round(stick.x), y: Math.round(stick.y), id: 3, radiusX: 4, radiusY: 4, force: 1 }] });
  for (let i = 1; i <= 3; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(stick.x), y: Math.round(stick.y + i * 15), id: 3, radiusX: 4, radiusY: 4, force: 1 }] });
    await sleep(30);
  }
  await sleep(250);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(300);
  const b = await cdp.eval(CAM);
  const input = await cdp.eval(INPUT);
  const placeAfter = await cdp.eval(`document.querySelector("[data-current-destination]")?.getAttribute("data-current-destination")`);
  const walked = horiz(a.avatar, b.avatar);
  expect(C, "the joystick walks the avatar in first person (1–10 m, no travel) and releases cleanly", walked > 1 && walked < 10 && place === placeAfter && input.touchCount === 0 && input.joystick.y === 0, { moved: round(walked, 2), place, placeAfter, input });
  expect(C, "the eye stays on the avatar", horiz(b.camera, b.avatar) < 0.3, round(horiz(b.camera, b.avatar)));
  expect(C, "no page errors", cdp.errors.length === 0, cdp.errors.slice(0, 5));
  cdp.close();
}

// ------------------------------------------------------------------------------------------ main
async function main() {
  if (!CHROME) {
    console.error("No Chrome found (set CHROME_PATH).");
    process.exit(2);
  }
  const server = await startServer(PORT);
  if (!server.external) results.build = buildFreshness();
  else results.build = { external: server.base };
  const { child, profileDir } = await launchChrome(CHROME, CDP_PORT);
  try {
    await desktop(server.base);
    await mobile(server.base);
  } catch (err) {
    results.failures.push(`probe aborted: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    log("ABORT", err);
  } finally {
    results.finishedAt = new Date().toISOString();
    save();
    killTree(child);
    if (server.child) killTree(server.child);
    await removeDir(profileDir);
  }
  log(results.failures.length === 0 ? "PASSED" : `FAILED (${results.failures.length})`, path.join(OUT_DIR, "camera-probe.json"));
  process.exit(results.failures.length === 0 ? 0 : 1);
}

void main();
