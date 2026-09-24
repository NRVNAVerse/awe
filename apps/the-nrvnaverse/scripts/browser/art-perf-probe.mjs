// @ts-check
// Representative-art performance probe for THE NRVNAVerse (M1.0), against the real production bundle.
//
//   pnpm --filter the-nrvnaverse build          # once, or after any app / engine / asset change
//   pnpm --filter the-nrvnaverse browser:perf   # starts `next start`, drives headless Chrome over raw CDP
//
// No dependencies (see cdp.mjs). Results: timestamped JSON + PNG screenshots in OUT_DIR (default: the
// OS temp dir), never in the repository. This is a MEASUREMENT tool: it asserts only that the page
// works (world placed, tracer loaded, no console errors) and never enforces a budget — M1 warning
// bands live in the asset gate as investigation triggers (docs/NRVNAVERSE_ASSET_PIPELINE.md).
//
// Per profile (desktop 1280x800 @1, emulated phone 390x844 @3):
//   cold load with a cleared HTTP cache → network (per request: bytes on the wire, resource bytes,
//   cache status), scene graph, renderer.info (draw calls / triangles per frame, memory), DPR, heap,
//   timings (ready wall time, the app's own nrvna:* measures) → the tracer's incremental cost
//   (visibility toggle) and world bounds → idle frame timing → RENDER-REGIME SPIKE on the same tracer:
//   A lit PBR (as committed) vs B1 the engine's global unlit regime (lighting component disabled) →
//   movement + Hub → Music → Hub travel sanity → warm reload (cache behaviour of the immutable GLB).
// Then, once on desktop: B2 the same GLB with KHR_materials_unlit, served in memory through CDP
// request interception (nothing is written to the repository).
//
// Unsupported / unreliable metrics are reported as { unsupported: "<reason>" }, never estimated.
// Frame timing comes from a desktop GPU in headless Chrome and says nothing about a phone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR, CHROME, killTree, launchChrome, log, newPage, sleep, startServer, waitFor } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3301);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9336);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-perf");
const TRACER_COMPONENT = "tracer-rock-monster";
const MUSIC_ID = "dst_gm3xs4a3tws7bgh3";
const HUB_ID = "dst_7g19n1vm9ackw8a0";

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

/**
 * @typedef {{ name: string, ua: string, w: number, h: number, dpr: number, mobile: boolean, touch: boolean }} Profile
 * @typedef {import("./cdp.mjs").CDP} CDP
 * @typedef {{ url: string, type?: string, status?: number, mime?: string, cacheControl?: string | null, fromDiskCache?: boolean, fromMemoryCache?: boolean, wireBytes: number, resourceBytes: number, failed?: string }} RequestRecord
 */

/** @type {Profile[]} */
const PROFILES = [
  { name: "desktop", ua: DESKTOP_UA, w: 1280, h: 800, dpr: 1, mobile: false, touch: false },
  { name: "mobile-emulated", ua: MOBILE_UA, w: 390, h: 844, dpr: 3, mobile: true, touch: true },
];

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync(OUT_DIR, { recursive: true });
/** @type {Record<string, any>} */
const results = { probe: "nrvnaverse-art-perf", version: 1, startedAt: new Date().toISOString(), profiles: {}, spike: {}, notes: [] };
const outFile = path.join(OUT_DIR, `art-perf-${stamp}.json`);
const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
/** @type {string[]} */
const failures = [];

/**
 * Console errors that are known ENGINE defects, not app or asset regressions. They are recorded in
 * the results (`knownEngineConsoleErrors`) and reported, but do not fail the probe. Every other
 * console error does.
 * - `ModelFactory` disposes a classic (animated) model with `wrapper.stop()` and no clip name
 *   (`packages/engine/src/internal/media/model/index.js`), so `ClassicWrapper.stop(null)` logs
 *   "STOP Animation not found null" whenever an animated model is destroyed (e.g. its chunk is
 *   retired on travel). Handed to the AWE library; not patched here.
 */
const KNOWN_ENGINE_CONSOLE_ERRORS = [/^STOP Animation not found\s*(null)?\s*$/];
/** @param {string[]} errors */
const splitConsoleErrors = (errors) => ({
  unexpected: errors.filter((e) => !KNOWN_ENGINE_CONSOLE_ERRORS.some((re) => re.test(e))),
  knownEngine: errors.filter((e) => KNOWN_ENGINE_CONSOLE_ERRORS.some((re) => re.test(e))),
});
/**
 * @param {string} label
 * @param {unknown} ok
 * @param {unknown} [detail]
 */
function require(label, ok, detail) {
  if (!ok) failures.push(`${label}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  log(ok ? "  ok  " : "  FAIL", label, detail === undefined ? "" : JSON.stringify(detail));
}

// ------------------------------------------------------------------------------------ network
/**
 * Per-request network bookkeeping for one page.
 * @param {CDP} cdp
 */
function trackNetwork(cdp) {
  /** @type {Map<string, RequestRecord>} */
  const requests = new Map();
  cdp.on("Network.requestWillBeSent", (p) => {
    if (!requests.has(p.requestId)) requests.set(p.requestId, { url: p.request.url, type: p.type, wireBytes: 0, resourceBytes: 0 });
  });
  cdp.on("Network.responseReceived", (p) => {
    const r = requests.get(p.requestId);
    if (!r) return;
    r.status = p.response.status;
    r.mime = p.response.mimeType;
    r.fromDiskCache = !!p.response.fromDiskCache;
    r.cacheControl = p.response.headers["cache-control"] ?? p.response.headers["Cache-Control"] ?? null;
  });
  cdp.on("Network.requestServedFromCache", (p) => {
    const r = requests.get(p.requestId);
    if (r) r.fromMemoryCache = true;
  });
  cdp.on("Network.dataReceived", (p) => {
    const r = requests.get(p.requestId);
    if (r) r.resourceBytes += p.dataLength;
  });
  cdp.on("Network.loadingFinished", (p) => {
    const r = requests.get(p.requestId);
    if (r) r.wireBytes = p.encodedDataLength;
  });
  cdp.on("Network.loadingFailed", (p) => {
    const r = requests.get(p.requestId);
    if (r) r.failed = p.errorText;
  });
  return requests;
}

/** @param {string} url */
function classify(url) {
  const u = url.split("?")[0];
  if (u.endsWith(".glb") || u.endsWith(".gltf")) return u.includes("/assets/art/") ? "art-glb" : "other-glb";
  if (u.endsWith(".vrm")) return "avatar";
  if (u.endsWith(".hdr") || u.endsWith(".exr")) return "environment";
  if (u.includes("/data/spatial/")) return "spatial-json";
  if (u.endsWith(".wasm")) return "wasm";
  if (u.endsWith(".js")) return "js";
  if (u.includes("/assets/anims/") || u.includes("ipfs")) return "animation";
  if (/\.(png|jpe?g|webp|ktx2|basis)$/.test(u)) return "image";
  return "other";
}

/** @param {Map<string, RequestRecord>} requests */
function summarizeNetwork(requests) {
  const list = [...requests.values()].filter((r) => r.url.startsWith("http"));
  /** @type {Record<string, { requests: number, wireBytes: number, resourceBytes: number }>} */
  const byClass = {};
  for (const r of list) {
    const k = classify(r.url);
    byClass[k] ??= { requests: 0, wireBytes: 0, resourceBytes: 0 };
    byClass[k].requests += 1;
    byClass[k].wireBytes += r.wireBytes;
    byClass[k].resourceBytes += r.resourceBytes;
  }
  const art = list.filter((r) => classify(r.url) === "art-glb").map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ""), status: r.status, cacheControl: r.cacheControl, fromDiskCache: r.fromDiskCache ?? false, fromMemoryCache: r.fromMemoryCache ?? false, wireBytes: r.wireBytes, resourceBytes: r.resourceBytes }));
  const env = list.filter((r) => classify(r.url) === "environment").map((r) => ({ url: r.url, wireBytes: r.wireBytes, resourceBytes: r.resourceBytes, fromDiskCache: r.fromDiskCache ?? false }));
  return {
    requests: list.length,
    totalWireBytes: list.reduce((s, r) => s + r.wireBytes, 0),
    totalResourceBytes: list.reduce((s, r) => s + r.resourceBytes, 0),
    byClass,
    art,
    environment: env,
    failed: list.filter((r) => r.failed).map((r) => ({ url: r.url, error: r.failed })),
  };
}

// ------------------------------------------------------------------------------------ in-page probes
const PLACED = `(() => { const ph = document.querySelector("header code")?.textContent; return ph && ["ready", "arrived", "gateRequired"].includes(ph) && globalThis.__nrvnaverseInput ? ph : null; })()`;
const TRACER_LOADED = `(() => { const c = globalThis.$space?.components.byId(${JSON.stringify(TRACER_COMPONENT)}); if (!c) return false; let meshes = 0; c.traverse((o) => { if (o.isMesh) meshes++; }); return meshes > 0; })()`;

// Wraps renderer.render so the probe can read the per-frame cumulative renderer.info (the engine
// resets it once per frame, autoReset off) and the scene that was drawn.
const WRAP_RENDERER = `(() => { const r = globalThis.renderer; if (!r) return "no-renderer"; if (r.__probeWrapped) return "already"; const orig = r.render; r.__probeWrapped = true;
  r.render = function (scene, camera) { const out = orig.call(this, scene, camera); if (scene && scene.isScene) globalThis.__probeScene = scene;
    globalThis.__probeFrame = { calls: this.info.render.calls, triangles: this.info.render.triangles, points: this.info.render.points, lines: this.info.render.lines }; return out; }; return "ok"; })()`;

const RENDERER = `(() => { const r = globalThis.renderer; if (!r) return null; const gl = r.getContext(); const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return { frame: globalThis.__probeFrame ?? null, memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures }, programs: r.info.programs ? r.info.programs.length : null,
    pixelRatio: r.getPixelRatio(), devicePixelRatio: devicePixelRatio, backing: [r.domElement.width, r.domElement.height], css: [innerWidth, innerHeight],
    shadowMapEnabled: r.shadowMap.enabled, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null }; })()`;

const SCENE = `(() => { const s = globalThis.__probeScene; const space = globalThis.$space; if (!s) return null;
  const st = { objects: 0, meshes: 0, visibleMeshes: 0, skinnedMeshes: 0, instancedMeshes: 0, triangles: 0, lights: 0 }; const mats = new Set(), geos = new Set(), texs = new Set(), types = {};
  const slots = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "lightMap", "envMap", "bumpMap"];
  s.traverse((o) => { st.objects++; if (o.isLight) st.lights++; if (!o.isMesh) return; st.meshes++; if (o.visible) st.visibleMeshes++; if (o.isSkinnedMesh) st.skinnedMeshes++; if (o.isInstancedMesh) st.instancedMeshes++;
    if (o.geometry) { geos.add(o.geometry.uuid); const g = o.geometry; const n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0); st.triangles += Math.round(n / 3) * (o.isInstancedMesh ? o.count : 1); }
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (!m) continue; mats.add(m.uuid); types[m.type] = (types[m.type] ?? 0) + 1; for (const k of slots) if (m[k] && m[k].isTexture) texs.add(m[k].uuid); } });
  return { components: space ? space.components.components.length : null, ...st, materials: mats.size, geometries: geos.size, texturesReferenced: texs.size, materialTypes: types,
    trianglesNote: "scene-graph triangles of every mesh (instanced x count), before frustum culling; renderer.frame.triangles is what was drawn" }; })()`;

const TRACER = `(() => { const c = globalThis.$space?.components.byId(${JSON.stringify(TRACER_COMPONENT)}); if (!c) return null; c.updateMatrixWorld(true);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; const meshes = []; let triangles = 0;
  c.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = bb.min.clone().set(x, y, z).applyMatrix4(o.matrixWorld); min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z); max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z); }
    const n = g.index ? g.index.count : g.attributes.position.count; triangles += Math.round(n / 3);
    const m = Array.isArray(o.material) ? o.material[0] : o.material; meshes.push({ type: o.type, skinned: !!o.isSkinnedMesh, materialType: m ? m.type : null, isBasic: !!(m && m.isMeshBasicMaterial), map: !!(m && m.map), castShadow: o.castShadow, receiveShadow: o.receiveShadow }); });
  return { worldBounds: { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) }, boundsNote: "geometry bounding boxes (bind pose) in world space; the animation deforms around them", meshes, triangles }; })()`;

const FRAME_TIMING = `new Promise((res) => { const times = []; let last = performance.now(); const t0 = last; const f = (t) => { times.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { times.shift(); times.sort((a, b) => a - b); const mean = times.reduce((s, v) => s + v, 0) / times.length;
  res({ frames: times.length, fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2), note: "headless Chrome on the host GPU — relative indicator only, not a device measurement" }); } }; requestAnimationFrame(f); })`;

const AVATAR = `(() => { const p = globalThis.$space?.components.byId("player"); return p ? { x: p.position.x, y: p.position.y, z: p.position.z } : null; })()`;
const MEASURES = `performance.getEntriesByType("measure").filter((m) => m.name.startsWith("nrvna:")).map((m) => ({ name: m.name, ms: +m.duration.toFixed(1) }))`;

/**
 * Hold one key until the avatar satisfies `until` (checked every 50 ms), with a runaway guard.
 * @param {CDP} cdp
 * @param {{ key: string, code: string, vk: number }} k
 * @param {(p: { x: number, y: number, z: number }) => boolean} until
 * @param {number} [timeoutMs]
 */
async function holdKeyUntil(cdp, k, until, timeoutMs = 3000) {
  const start = await cdp.eval(AVATAR);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
  const t0 = Date.now();
  let p = start;
  try {
    while (Date.now() - t0 < timeoutMs) {
      await sleep(50);
      p = await cdp.eval(AVATAR);
      if (until(p) || Math.hypot(p.x - start.x, p.z - start.z) > 25) break;
    }
  } finally {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
  }
  await sleep(500);
  return cdp.eval(AVATAR);
}

/**
 * Walk from the Hub spawn to a close-up view of the tracer: first +X past the Cannabis sensor's
 * x-range (|x| ≤ 3), then −Z towards the tracer, stopping short of it. The camera stays behind the
 * avatar looking −Z. Desktop keyboard only.
 * @param {CDP} cdp
 */
async function walkToTracerCloseUp(cdp) {
  const D = { key: "d", code: "KeyD", vk: 68 };
  const W = { key: "w", code: "KeyW", vk: 87 };
  await holdKeyUntil(cdp, D, (p) => p.x >= 4.2);
  const at = await holdKeyUntil(cdp, W, (p) => p.z <= -2.5);
  return { avatar: { x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) }, phase: await cdp.eval(`document.querySelector("header code")?.textContent ?? null`) };
}

/** @param {CDP} cdp */
async function frameInfo(cdp) {
  await sleep(400);
  return cdp.eval(RENDERER);
}

/**
 * @param {CDP} cdp
 * @param {boolean} enabled
 */
async function setLighting(cdp, enabled) {
  await cdp.eval(`(() => { const L = globalThis.$space.components.byId("lighting"); L.data.enabled = ${enabled}; return true; })()`);
  return waitFor(cdp, `(() => { const L = globalThis.$space.components.byId("lighting"); return L && L._lighting && L._lighting.active === ${enabled} && globalThis.renderer.shadowMap.enabled === ${enabled}; })()`, { timeout: 10_000, label: `lighting ${enabled ? "on" : "off"}` });
}

/**
 * @param {CDP} cdp
 * @param {string} name
 */
async function screenshot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `art-perf-${stamp}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

/**
 * @param {CDP} cdp
 * @param {Profile} profile
 */
async function emulate(cdp, profile) {
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: profile.ua });
  if (profile.touch) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: profile.w, height: profile.h, deviceScaleFactor: profile.dpr, mobile: profile.mobile,
    screenOrientation: { type: profile.w > profile.h ? "landscapePrimary" : "portraitPrimary", angle: profile.w > profile.h ? 90 : 0 },
  });
}

/**
 * Cold-load a page for the profile and wait for the world and the tracer.
 * @param {string} base
 * @param {Profile} profile
 */
async function openCold(base, profile) {
  const cdp = await newPage(CDP_PORT);
  const requests = trackNetwork(cdp);
  await cdp.send("Network.clearBrowserCache");
  await emulate(cdp, profile);
  const t0 = Date.now();
  await cdp.send("Page.navigate", { url: base + "/" });
  const phase = await waitFor(cdp, PLACED, { label: "world placed" });
  const readyWallMs = Date.now() - t0;
  await waitFor(cdp, TRACER_LOADED, { timeout: 60_000, label: "tracer model loaded" });
  const tracerWallMs = Date.now() - t0;
  await cdp.eval(WRAP_RENDERER);
  await sleep(1200); // settle: static shadow refresh, first animation frames
  return { cdp, requests, phase, readyWallMs, tracerWallMs };
}

// ------------------------------------------------------------------------------------ per profile
/**
 * @param {string} base
 * @param {Profile} profile
 */
async function probeProfile(base, profile) {
  log("profile", profile.name);
  const { cdp, requests, phase, readyWallMs, tracerWallMs } = await openCold(base, profile);
  /** @type {Record<string, any>} */
  const R = { profile, phase };
  R.network = { cold: summarizeNetwork(requests) };
  R.runtime = {
    readyWallMs, tracerLoadedWallMs: tracerWallMs, readyNote: "wall time from Page.navigate to the placed world / to the tracer mesh being present",
    heap: await cdp.send("Runtime.getHeapUsage"),
    measures: await cdp.eval(MEASURES),
  };
  R.renderer = await frameInfo(cdp);
  R.scene = await cdp.eval(SCENE);
  R.tracer = await cdp.eval(TRACER);

  // Incremental cost of the tracer: the same frame with and without it.
  await cdp.eval(`globalThis.$space.components.byId(${JSON.stringify(TRACER_COMPONENT)}).visible = false`);
  const without = await frameInfo(cdp);
  await cdp.eval(`globalThis.$space.components.byId(${JSON.stringify(TRACER_COMPONENT)}).visible = true`);
  const withTracer = await frameInfo(cdp);
  R.tracer.incremental = {
    drawCalls: withTracer.frame && without.frame ? withTracer.frame.calls - without.frame.calls : { unsupported: "no frame info" },
    triangles: withTracer.frame && without.frame ? withTracer.frame.triangles - without.frame.triangles : { unsupported: "no frame info" },
    note: "per-frame renderer.info delta with the tracer hidden vs shown (includes its shadow-map passes when lit)",
  };

  // Render-regime spike on the same tracer.
  R.regimes = {};
  R.regimes.litPbr = { renderer: await frameInfo(cdp), tracer: await cdp.eval(TRACER), frameTiming: await cdp.eval(FRAME_TIMING), screenshot: await screenshot(cdp, `${profile.name}-A-lit`) };
  await setLighting(cdp, false);
  await sleep(600);
  R.regimes.globalUnlit = { renderer: await frameInfo(cdp), tracer: await cdp.eval(TRACER), frameTiming: await cdp.eval(FRAME_TIMING), screenshot: await screenshot(cdp, `${profile.name}-B1-global-unlit`) };
  await setLighting(cdp, true);
  await sleep(600);
  R.regimes.restored = { shadowMapEnabled: (await frameInfo(cdp)).shadowMapEnabled };

  // Close-up of the same comparison (desktop keyboard walk; the phone keeps the spawn view).
  if (!profile.touch) {
    R.closeUp = { walk: await walkToTracerCloseUp(cdp) };
    R.closeUp.litPbr = { screenshot: await screenshot(cdp, `${profile.name}-A-lit-closeup`), renderer: await frameInfo(cdp) };
    await setLighting(cdp, false);
    await sleep(600);
    R.closeUp.globalUnlit = { screenshot: await screenshot(cdp, `${profile.name}-B1-global-unlit-closeup`), renderer: await frameInfo(cdp) };
    await setLighting(cdp, true);
    await sleep(600);
  }

  // Movement sanity (desktop keyboard; the phone profile's touch paths are covered by browser:touch).
  if (!profile.touch) {
    const a = await cdp.eval(AVATAR);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await sleep(600);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
    await sleep(400);
    const b = await cdp.eval(AVATAR);
    R.movement = { keyboardBackwardMeters: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) };
  } else {
    R.movement = { unsupported: "touch movement is verified by pnpm browser:touch" };
  }

  // Travel sanity: Hub → Music → Hub through the directory (DOM click).
  /** @param {string} id */
  const travel = async (id) => {
    await cdp.eval(`(() => { const open = document.querySelector('[data-panel-toggle="open"]'); if (open) open.click(); return true; })()`);
    await sleep(300);
    const t0 = Date.now();
    await cdp.eval(`document.querySelector('a[data-destination-id="${id}"]').click()`);
    // Wait for the terminal banner (the intermediate "loadingChunk" banner is not an outcome).
    const banner = await waitFor(cdp, `(() => { const p = document.querySelector("[data-phase]")?.getAttribute("data-phase"); return p && p !== "loadingChunk" ? p : null; })()`, { timeout: 20_000, every: 50, label: "travel outcome banner" });
    const wall = Date.now() - t0;
    await cdp.eval(`(() => { const ok = document.querySelector("[data-phase] button"); if (ok) ok.click(); return true; })()`);
    await sleep(300);
    return { banner, wallMs: wall };
  };
  R.travel = { hubToMusic: await travel(MUSIC_ID), musicToHub: await travel(HUB_ID), measures: (await cdp.eval(MEASURES)).filter((/** @type {{name:string}} */ m) => /travel|chunk/.test(m.name)).slice(-6) };
  await waitFor(cdp, TRACER_LOADED, { timeout: 30_000, label: "tracer re-staged after returning to the Hub" });
  R.runtime.heapAfterTravel = await cdp.send("Runtime.getHeapUsage");

  // Warm reload: the immutable content-addressed GLB must come from the HTTP cache.
  requests.clear();
  await cdp.send("Page.reload", {});
  await waitFor(cdp, PLACED, { label: "world placed (warm)" });
  await waitFor(cdp, TRACER_LOADED, { timeout: 60_000, label: "tracer loaded (warm)" });
  await sleep(800);
  R.network.warmReload = summarizeNetwork(requests);
  const consoleErrors = splitConsoleErrors(cdp.errors);
  R.errors = consoleErrors.unexpected;
  R.knownEngineConsoleErrors = consoleErrors.knownEngine;
  cdp.close();

  const art = R.network.cold.art[0];
  require(`${profile.name}: world placed`, ["ready", "arrived", "gateRequired"].includes(phase), phase);
  require(`${profile.name}: tracer GLB fetched once, 200, immutable`, R.network.cold.art.length === 1 && art.status === 200 && /immutable/.test(art.cacheControl ?? ""), R.network.cold.art);
  require(`${profile.name}: tracer rendered (mesh present, draw calls added)`, R.tracer && R.tracer.meshes.length > 0 && typeof R.tracer.incremental.drawCalls === "number" && R.tracer.incremental.drawCalls > 0, R.tracer?.incremental);
  // Observed engine behaviour, pinned so a change is noticed: the global regime switch toggles the
  // sun / shadows for everything, but an ANIMATED model is loaded on the engine's classic path and
  // keeps its glTF MeshStandardMaterial (it never becomes unlit through this switch).
  require(`${profile.name}: lit regime has shadows and global-unlit has none`, R.regimes.litPbr.renderer.shadowMapEnabled === true && R.regimes.globalUnlit.renderer.shadowMapEnabled === false);
  require(`${profile.name}: animated tracer keeps a lit (Standard) material under the global unlit switch`, R.regimes.globalUnlit.tracer.meshes.every((/** @type {{materialType:string}} */ m) => m.materialType === "MeshStandardMaterial"), R.regimes.globalUnlit.tracer.meshes);
  if (R.closeUp) require(`${profile.name}: close-up walk reached the tracer without triggering travel`, R.closeUp.walk.avatar.x >= 4 && R.closeUp.walk.avatar.z <= -2 && R.closeUp.walk.phase === "ready", R.closeUp.walk);
  require(`${profile.name}: lighting restored`, R.regimes.restored.shadowMapEnabled === true);
  require(`${profile.name}: travel Hub → Music → Hub arrives`, R.travel.hubToMusic.banner === "arrived" && R.travel.musicToHub.banner === "arrived", R.travel);
  const warmArt = R.network.warmReload.art;
  require(`${profile.name}: warm reload serves the GLB from cache with no wire bytes`, warmArt.length <= 1 && warmArt.every((/** @type {{fromDiskCache:boolean, fromMemoryCache:boolean, wireBytes:number}} */ a) => (a.fromDiskCache || a.fromMemoryCache) && a.wireBytes < 1024), warmArt);
  require(`${profile.name}: no console errors (known engine noise recorded separately)`, R.errors.length === 0, R.errors);
  if (R.knownEngineConsoleErrors.length) log(`  note ${profile.name}: known engine console errors`, JSON.stringify(R.knownEngineConsoleErrors));
  return R;
}

// ------------------------------------------------------------------------------------ B2: KHR_materials_unlit
/**
 * The tracer GLB with KHR_materials_unlit added to every material (JSON chunk only; the binary
 * chunk is untouched). In memory only.
 * @param {Buffer} glb
 */
export function withUnlitMaterials(glb) {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  for (const m of json.materials ?? []) m.extensions = { ...(m.extensions ?? {}), KHR_materials_unlit: {} };
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "KHR_materials_unlit"])];
  let text = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (text.length % 4)) % 4;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const rest = glb.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, text, rest]);
}

/** @param {string} base */
async function probeUnlitVariant(base) {
  log("spike B2: KHR_materials_unlit variant");
  const registry = JSON.parse(fs.readFileSync(path.join(APP_DIR, "spatial", "source", "asset-registry.json"), "utf8"));
  const record = Object.values(registry.assets).find((/** @type {any} */ a) => a.name.includes("Rock Monster"));
  const artifact = /** @type {any} */ (record).revisions[String(/** @type {any} */ (record).currentRevision)].artifact;
  const original = fs.readFileSync(path.join(APP_DIR, "public", ...artifact.storage.objectKey.split("/")));
  const variant = withUnlitMaterials(original);

  const cdp = await newPage(CDP_PORT);
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/assets/art/*.glb", requestStage: "Request" }] });
  let served = 0;
  cdp.on("Fetch.requestPaused", (p) => {
    served += 1;
    void cdp.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "model/gltf-binary" }, { name: "Cache-Control", value: "no-store" }], body: variant.toString("base64") });
  });
  await emulate(cdp, PROFILES[0]);
  await cdp.send("Page.navigate", { url: base + "/" });
  await waitFor(cdp, PLACED, { label: "world placed (B2)" });
  await waitFor(cdp, TRACER_LOADED, { timeout: 60_000, label: "tracer loaded (B2)" });
  await cdp.eval(WRAP_RENDERER);
  await sleep(1200);
  /** @type {Record<string, any>} */
  const R = { variantBytes: variant.length, originalBytes: original.length, servedByInterception: 0 };
  R.underLitRegime = { renderer: await frameInfo(cdp), tracer: await cdp.eval(TRACER), screenshot: await screenshot(cdp, "desktop-B2-khr-unlit-lit-regime") };
  R.closeUp = { walk: await walkToTracerCloseUp(cdp) };
  R.closeUp.screenshot = await screenshot(cdp, "desktop-B2-khr-unlit-closeup");
  await setLighting(cdp, false);
  await sleep(600);
  R.underGlobalUnlit = { renderer: await frameInfo(cdp), tracer: await cdp.eval(TRACER), screenshot: await screenshot(cdp, "desktop-B2-khr-unlit-global-unlit-closeup") };
  R.servedByInterception = served;
  const consoleErrors = splitConsoleErrors(cdp.errors);
  R.errors = consoleErrors.unexpected;
  R.knownEngineConsoleErrors = consoleErrors.knownEngine;
  cdp.close();
  require("B2: variant served through interception", served >= 1, served);
  require("B2: KHR_materials_unlit yields a basic (unlit) material on the animated tracer in both regimes", [...R.underLitRegime.tracer.meshes, ...R.underGlobalUnlit.tracer.meshes].every((/** @type {{isBasic:boolean}} */ m) => m.isBasic), { lit: R.underLitRegime.tracer.meshes, unlit: R.underGlobalUnlit.tracer.meshes });
  require("B2: no console errors (known engine noise recorded separately)", R.errors.length === 0, R.errors);
  return R;
}

// ------------------------------------------------------------------------------------ main
if (!CHROME) {
  console.error("Chrome not found: set CHROME_PATH.");
  process.exit(2);
}
/** @type {{ base: string, child: import("node:child_process").ChildProcess | null } | null} */
let server = null;
/** @type {import("node:child_process").ChildProcess | null} */
let chrome = null;
try {
  server = await startServer(PORT);
  chrome = await launchChrome(CHROME, CDP_PORT);
  log("server", server.base);
  for (const profile of PROFILES) {
    try {
      results.profiles[profile.name] = await probeProfile(server.base, profile);
    } catch (e) {
      require(`${profile.name}: probe ran to completion`, false, String(e instanceof Error ? e.stack : e).slice(0, 500));
    }
    save();
  }
  try {
    results.spike.khrMaterialsUnlit = await probeUnlitVariant(server.base);
  } catch (e) {
    require("B2: probe ran to completion", false, String(e instanceof Error ? e.stack : e).slice(0, 500));
  }
} finally {
  killTree(chrome);
  killTree(server?.child);
}
results.notes.push(
  "Measurements only — no budget is enforced here. M1 warning bands are investigation triggers in the asset gate.",
  "Frame timing is headless Chrome on the host GPU: a relative indicator, never a phone measurement.",
  "renderer frame calls / triangles are per-frame cumulative renderer.info including shadow-map passes.",
);
results.failures = failures;
results.finishedAt = new Date().toISOString();
save();
log(failures.length ? `FAILED (${failures.length})` : "PASSED", "->", outFile);
for (const f of failures) log("  -", f);
process.exitCode = failures.length ? 1 : 0;
