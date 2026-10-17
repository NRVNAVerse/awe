// @ts-check
// Gallery One probe (M3 Mission C), against the real bundle.
//
//   pnpm --filter the-nrvnaverse build            # once, or after any app / world change
//   pnpm --filter the-nrvnaverse browser:gallery  # starts `next start`, drives headless Chrome over raw CDP
//
// BASE_URL reuses a running server; results go to OUT_DIR (default: OS temp dir). Exit 0 = passed,
// 1 = a check failed, 2 = environment missing. Real input (CDP keys / touches) throughout.
//
//   D  desktop: Hub → Gallery One through the directory (DOM click, like browser:perf) arrives at the
//      authored spawn facing east; the ASSIGNED exhibition's components exist and no other exhibition's
//      do; walking backward leaves through the door onto the forecourt and forward walks back in;
//      V gives first person inside; no page errors.
//      Out of the door, up the avenue into the plaza cell and back into South Row: the place stays
//      "The City" (the gallery never renames its cell).
//   M  phone (390×844, touch): the deep link lands in Gallery One; the joystick walks out through the door.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR, CDP, CHROME, buildFreshness, killTree, launchChrome, log, removeDir, sleep, startServer, waitFor } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3321);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9338);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-gallery");
const GALLERY_ID = "dst_3kacg0rqgyfnp7fm";
const CITY_ID = "dst_8w1j39h5e0ezrsjh";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
/** Authored spawn marker (Blender fixture) and the doorway plane (west wall, x 33.6 – 34). */
const SPAWN = { x: 37, z: 150 };
const DOOR_OUTER_X = 33.6;
const DOOR_INNER_X = 34;

// What the committed world should show: the assignment and both exhibitions' component prefixes.
const assignments = JSON.parse(fs.readFileSync(path.join(APP_DIR, "spatial/source/gallery-assignments.json"), "utf8")).assignments;
const exhibitions = fs
  .readdirSync(path.join(APP_DIR, "spatial/source/exhibitions"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(APP_DIR, "spatial/source/exhibitions", f), "utf8")));
const assigned = exhibitions.find((e) => e.id === assignments["gallery-one"]);
const others = exhibitions.filter((e) => e !== assigned);

const results = /** @type {{ startedAt: string, finishedAt?: string, build?: unknown, assigned: string | null, checks: Record<string, Array<{ label: string, ok: boolean, detail?: unknown }>>, failures: string[] }} */ ({
  startedAt: new Date().toISOString(),
  assigned: assigned?.slug ?? null,
  checks: {},
  failures: [],
});
fs.mkdirSync(OUT_DIR, { recursive: true });
const save = () => fs.writeFileSync(path.join(OUT_DIR, "gallery-probe.json"), JSON.stringify(results, null, 2));
/** @param {string} check @param {string} label @param {unknown} ok @param {unknown} [detail] */
function expect(check, label, ok, detail) {
  (results.checks[check] ??= []).push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) results.failures.push(`${check}: ${label}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  log(ok ? "  ok  " : "  FAIL", `${check}: ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  save();
}

const CAM = `globalThis.__nrvnaverseCamera.snapshot()`;
const PLACE = `document.querySelector("[data-current-destination]")?.getAttribute("data-current-destination")`;
const SETTLED = `(() => { const ph = document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase"); return ph && ["ready", "arrived"].includes(ph) && globalThis.__nrvnaverseCamera?.snapshot()?.active ? ph : null; })()`;
/** Exhibition component ids present in the live space, by slug. */
const PRESENT = (/** @type {string[]} */ slugs) =>
  `(() => { const ids = globalThis.$space?.components ? globalThis.$space.components.filter(() => true).map((c) => c.data?.id) : []; const out = {}; for (const s of ${JSON.stringify(slugs)}) out[s] = ids.filter((id) => typeof id === "string" && id.startsWith("gallery-one-exh-" + s + "-")).length; out.shell = ids.filter((id) => typeof id === "string" && id.startsWith("gallery-one-shell-")).length; out.total = ids.length; return out; })()`;
/** @param {number} a */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** @param {CDP} cdp @param {string} code @param {string} key @param {number} vk @param {number} ms */
async function hold(cdp, code, key, vk, ms) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk });
  await sleep(ms);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
}

/**
 * @param {string} base
 * @param {{ w: number, h: number, dpr: number, mobile: boolean, ua?: string }} profile
 * @param {string} query
 */
async function open(base, profile, query) {
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
  if (profile.mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: profile.w, height: profile.h, deviceScaleFactor: profile.dpr, mobile: profile.mobile });
  await cdp.send("Page.navigate", { url: base + "/" + query });
  await waitFor(cdp, SETTLED, { label: "world placed" });
  await sleep(1500);
  return cdp;
}

/** @param {CDP} cdp @param {string} name */
async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
}

/** @param {string} base */
async function desktop(base) {
  const C = "D-desktop";
  const cdp = await open(base, { w: 1280, h: 800, dpr: 1, mobile: false }, "");
  // Hub → Gallery One through the directory (the desktop directory starts open).
  await cdp.eval(`(() => { const open = document.querySelector('[data-panel-toggle="open"]'); if (open) open.click(); return true; })()`);
  await sleep(300);
  const link = await cdp.eval(`!!document.querySelector('a[data-destination-id="${GALLERY_ID}"]')`);
  expect(C, "the directory lists Gallery One", link);
  await cdp.eval(`document.querySelector('a[data-destination-id="${GALLERY_ID}"]').click()`);
  const banner = await waitFor(cdp, `(() => { const p = document.querySelector("[data-phase]")?.getAttribute("data-phase"); return p && p !== "loadingChunk" ? p : null; })()`, { timeout: 30_000, every: 100, label: "travel outcome" });
  await cdp.eval(`(() => { const ok = document.querySelector("[data-phase] button"); if (ok) ok.click(); const close = document.querySelector('[data-panel-toggle="close"]'); if (close) close.click(); return true; })()`);
  await sleep(1500);
  const s = await cdp.eval(CAM);
  const place = await cdp.eval(PLACE);
  expect(C, "Hub → Gallery One arrives (directory travel)", banner === "arrived" && place === GALLERY_ID, { banner, place });
  expect(C, "arrival at the authored spawn marker (±0.3 m), on the floor", Math.hypot(s.avatar.x - SPAWN.x, s.avatar.z - SPAWN.z) < 0.3 && s.avatar.y > -0.1 && s.avatar.y < 1.2, s.avatar);
  expect(C, "facing east into the room (authored yaw −90°)", Math.abs(wrap(s.yaw + Math.PI / 2)) < 0.05, { yaw: s.yaw });
  await shot(cdp, "desktop-gallery-arrive");
  const present = await cdp.eval(PRESENT(exhibitions.map((e) => e.slug)));
  expect(C, `the assigned exhibition (${assigned?.slug}) is on show; no other exhibition's components exist`, assigned && present[assigned.slug] > 0 && others.every((e) => present[e.slug] === 0) && present.shell >= 13, present);

  // Out through the door (backward = west) and back in (forward = east).
  await hold(cdp, "KeyS", "s", 83, 450);
  await sleep(500);
  const out = (await cdp.eval(CAM)).avatar;
  expect(C, "walking backward leaves through the door onto the forecourt", out.x < DOOR_OUTER_X && Math.abs(out.z - 150) < 2 && out.y > -0.1, out);
  await hold(cdp, "KeyW", "w", 87, 450);
  await sleep(500);
  const back = (await cdp.eval(CAM)).avatar;
  expect(C, "walking forward comes back in through the same door", back.x > DOOR_INNER_X && Math.abs(back.z - 150) < 2, back);
  expect(C, "still at Gallery One (walking never re-identifies the place)", (await cdp.eval(PLACE)) === GALLERY_ID);

  await hold(cdp, "KeyV", "v", 86, 60);
  await sleep(400);
  const f = await cdp.eval(CAM);
  expect(C, "V gives first person inside the gallery", f.view === "first" && f.avatarVisible === false);
  await shot(cdp, "desktop-gallery-first");
  await hold(cdp, "KeyV", "v", 86, 60);
  expect(C, "no page errors", cdp.errors.length === 0, cdp.errors.slice(0, 5));
  cdp.close();

  // Walking between cells: out of the gallery, up the avenue into the plaza cell, back down into South
  // Row (the gallery's cell). The place is The City throughout: a venue standing in a cell never
  // renames the cell or rewrites the URL of a passer-by (the plaza's name wall blocks the south axis,
  // so the route starts at the gallery door).
  const W = "D-walk-in";
  const city = await open(base, { w: 1280, h: 800, dpr: 1, mobile: false }, `?destination=${GALLERY_ID}`);
  const where = async () => city.eval(`({ cam: ${CAM}, place: ${PLACE}, url: location.search })`);
  await hold(city, "KeyS", "s", 83, 2000); // facing east: backward = west, out of the door to the avenue
  await hold(city, "KeyA", "a", 65, 4200); // left = north, up the avenue past z 96 into the plaza cell
  await sleep(1500);
  const north = await where();
  expect(W, "walked out and north into the plaza cell: The City", north.cam.avatar.z < 96 && north.place === CITY_ID, { avatar: north.cam.avatar, place: north.place });
  await hold(city, "KeyD", "d", 68, 2600); // right = south, back past z 104 into South Row
  await sleep(1500);
  const south = await where();
  expect(W, "back south into South Row (the gallery's cell): still The City, URL included", south.cam.avatar.z > 104 && south.place === CITY_ID && south.url.includes(CITY_ID) && !south.url.includes(GALLERY_ID), { avatar: south.cam.avatar, place: south.place, url: south.url });
  expect(W, "no page errors", city.errors.length === 0, city.errors.slice(0, 5));
  city.close();
}

/** @param {string} base */
async function phone(base) {
  const C = "M-phone";
  const cdp = await open(base, { w: 390, h: 844, dpr: 3, mobile: true, ua: MOBILE_UA }, `?destination=${GALLERY_ID}`);
  const s = await cdp.eval(CAM);
  expect(C, "the deep link lands in Gallery One at the authored spawn", (await cdp.eval(PLACE)) === GALLERY_ID && Math.hypot(s.avatar.x - SPAWN.x, s.avatar.z - SPAWN.z) < 0.3, s.avatar);
  await shot(cdp, "phone-gallery-arrive");
  const stick = await cdp.eval(`(() => { const b = document.querySelector("[data-touch-joystick]")?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
  expect(C, "joystick present", stick);
  if (stick) {
    const p = (/** @type {number} */ dy) => ({ x: Math.round(stick.x), y: Math.round(stick.y + dy), id: 4, radiusX: 4, radiusY: 4, force: 1 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p(0)] });
    for (let i = 1; i <= 3; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p(i * 15)] });
      await sleep(30);
    }
    await sleep(450);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(500);
    const out = (await cdp.eval(CAM)).avatar;
    expect(C, "the joystick (pulled back) walks out through the door", out.x < DOOR_OUTER_X && Math.abs(out.z - 150) < 2, out);
  }
  expect(C, "no page errors", cdp.errors.length === 0, cdp.errors.slice(0, 5));
  cdp.close();
}

async function main() {
  if (!CHROME) {
    console.error("No Chrome found (set CHROME_PATH).");
    process.exit(2);
  }
  const server = await startServer(PORT);
  results.build = server.external ? { external: server.base } : buildFreshness();
  const { child, profileDir } = await launchChrome(CHROME, CDP_PORT);
  try {
    await desktop(server.base);
    await phone(server.base);
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
  log(results.failures.length === 0 ? "PASSED" : `FAILED (${results.failures.length})`, path.join(OUT_DIR, "gallery-probe.json"));
  process.exit(results.failures.length === 0 ? 0 : 1);
}

void main();
