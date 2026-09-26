// @ts-check
// Performance / delivery probe for THE NRVNAVerse, against the real production bundle.
//
//   pnpm --filter the-nrvnaverse build          # once, or after any app / engine / asset change
//   pnpm --filter the-nrvnaverse browser:perf   # starts `next start`, drives headless Chrome over raw CDP
//
// No dependencies (see cdp.mjs). Results: timestamped JSON + one PNG per profile in OUT_DIR (default:
// the OS temp dir), never in the repository. This is a MEASUREMENT tool: it asserts only that the
// page works and that delivery behaves as designed, and never enforces a budget (asset warning bands
// live in the asset gate, docs/NRVNAVERSE_ASSET_PIPELINE.md).
//
// Asset-independent. With no argument it measures the world as committed (the no-art baseline).
// ASSET_COMPONENT=<scene component id> additionally measures one runtime asset placed in the Hub:
// its GLB request (fetched once, 200, immutable), its warm-cache hit, its world bounds and its
// incremental per-frame cost (visibility toggle).
//
// Per profile (desktop 1280x800 @1; phone EMULATION 390x844 @3 on the host GPU — not a phone):
//   cold load, fresh throw-away Chrome profile + cleared HTTP cache → per request: bytes on the wire
//   (encodedDataLength, incl. headers) and decoded resource bytes, status, Cache-Control, cache hit;
//   scene graph; renderer.info per frame (draw calls / triangles incl. shadow passes, memory); DPR;
//   JS heap; ready wall time and the app's nrvna:* measures; idle frame timing; movement (desktop);
//   Hub → Music → Hub travel; warm reload (every immutable response of the cold load that is requested
//   again must come from the HTTP cache, and at least one must be).
//
// Failure semantics: any HTTP status >= 400, any failed request, any unexpected console error or
// uncaught exception, a stale build, or a check that observed nothing fails the run (exit 1).
// Missing environment (no Chrome / no build / busy port) exits 2. Unsupported metrics are labelled,
// never estimated.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHROME, buildFreshness, killTree, launchChrome, log, newPage, removeDir, sleep, startServer, waitFor } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3301);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9336);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-perf");
/** Optional scene component id of ONE runtime asset under test (in the Hub chunk). */
const ASSET_COMPONENT = process.env.ASSET_COMPONENT || null;
const MUSIC_ID = "dst_gm3xs4a3tws7bgh3";
const HUB_ID = "dst_7g19n1vm9ackw8a0";

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

/**
 * @typedef {{ name: string, ua: string, w: number, h: number, dpr: number, mobile: boolean, touch: boolean, note: string }} Profile
 * @typedef {import("./cdp.mjs").CDP} CDP
 * @typedef {{ url: string, type?: string, status?: number, mime?: string, cacheControl?: string | null, fromDiskCache?: boolean, fromMemoryCache?: boolean, wireBytes: number, resourceBytes: number, failed?: string }} RequestRecord
 */

/** @type {Profile[]} */
const PROFILES = [
  { name: "desktop", ua: DESKTOP_UA, w: 1280, h: 800, dpr: 1, mobile: false, touch: false, note: "headless Chrome on the host GPU" },
  { name: "mobile-emulated", ua: MOBILE_UA, w: 390, h: 844, dpr: 3, mobile: true, touch: true, note: "EMULATED phone viewport / UA / DPR on the host CPU + GPU — bytes, requests and draw calls are meaningful; timings and frame rates are NOT phone measurements" },
];

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.mkdirSync(OUT_DIR, { recursive: true });
/** @type {Record<string, any>} */
const results = { probe: "nrvnaverse-perf", version: 2, startedAt: new Date().toISOString(), assetComponent: ASSET_COMPONENT, profiles: {}, notes: [] };
const outFile = path.join(OUT_DIR, `perf-${stamp}.json`);
const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
/** @type {string[]} */
const failures = [];

/**
 * Console errors that are known ENGINE defects, not app or asset regressions — deliberately narrow:
 * each entry names the exact message AND the only phase in which it is expected. Outside that phase,
 * or in any other form, the same text is an unexpected error and fails the run.
 * - `ModelFactory` disposes a classic (animated) model with `wrapper.stop()` and no clip name
 *   (`packages/engine/src/internal/media/model/index.js`), so `ClassicWrapper.stop(null)` logs
 *   "STOP Animation not found null" when an animated model is destroyed — i.e. when its chunk is
 *   retired on travel. Generic engine defect handed to the AWE platform lane; not patched here.
 */
const KNOWN_ENGINE_CONSOLE_ERRORS = [{ id: "animated-model-dispose-stop-null", pattern: /^STOP Animation not found\s*(null)?\s*$/, phase: "after-chunk-retire" }];

/**
 * @param {string[]} errors
 * @param {number} retireStartIndex index in `errors` from which a chunk retire had started (errors before it are pre-travel)
 */
function splitConsoleErrors(errors, retireStartIndex) {
  /** @type {string[]} */
  const unexpected = [];
  /** @type {Record<string, number>} */
  const known = {};
  errors.forEach((e, i) => {
    const match = KNOWN_ENGINE_CONSOLE_ERRORS.find((k) => k.pattern.test(e) && k.phase === "after-chunk-retire" && i >= retireStartIndex);
    if (match) known[match.id] = (known[match.id] ?? 0) + 1;
    else unexpected.push(e);
  });
  return { unexpected, known };
}

/**
 * @param {string} label
 * @param {unknown} ok
 * @param {unknown} [detail]
 */
function check(label, ok, detail) {
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

/** @param {string} url */
const pathOf = (url) => url.replace(/^https?:\/\/[^/]+/, "");

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
  /** @param {RequestRecord} r */
  const brief = (r) => ({ url: pathOf(r.url), status: r.status, cacheControl: r.cacheControl ?? null, fromDiskCache: r.fromDiskCache ?? false, fromMemoryCache: r.fromMemoryCache ?? false, wireBytes: r.wireBytes, resourceBytes: r.resourceBytes });
  return {
    requests: list.length,
    totalWireBytes: list.reduce((s, r) => s + r.wireBytes, 0),
    totalResourceBytes: list.reduce((s, r) => s + r.resourceBytes, 0),
    byClass,
    art: list.filter((r) => classify(r.url) === "art-glb").map(brief),
    environment: list.filter((r) => classify(r.url) === "environment").map((r) => ({ url: r.url, wireBytes: r.wireBytes, resourceBytes: r.resourceBytes, fromDiskCache: r.fromDiskCache ?? false })),
    immutable: list.filter((r) => /immutable/.test(r.cacheControl ?? "")).map(brief),
    httpErrors: list.filter((r) => typeof r.status === "number" && r.status >= 400).map(brief),
    failed: list.filter((r) => r.failed && r.failed !== "net::ERR_ABORTED").map((r) => ({ url: r.url, error: r.failed })),
    aborted: list.filter((r) => r.failed === "net::ERR_ABORTED").map((r) => pathOf(r.url)),
    notes: "wireBytes = encodedDataLength (compressed body + headers; 0 for a cache hit); resourceBytes = decoded body bytes",
  };
}

// ------------------------------------------------------------------------------------ in-page probes
const PLACED = `(() => { const ph = document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase"); return ph && ["ready", "arrived", "gateRequired"].includes(ph) && globalThis.__nrvnaverseInput ? ph : null; })()`;
/** @param {string} id */
const ASSET_LOADED = (id) => `(() => { const c = globalThis.$space?.components.byId(${JSON.stringify(id)}); if (!c) return false; let meshes = 0; c.traverse((o) => { if (o.isMesh) meshes++; }); return meshes > 0; })()`;

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

/** @param {string} id */
const ASSET = (id) => `(() => { const c = globalThis.$space?.components.byId(${JSON.stringify(id)}); if (!c) return null; c.updateMatrixWorld(true);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; const meshes = []; let triangles = 0;
  c.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = bb.min.clone().set(x, y, z).applyMatrix4(o.matrixWorld); min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z); max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z); }
    const n = g.index ? g.index.count : g.attributes.position.count; triangles += Math.round(n / 3);
    const m = Array.isArray(o.material) ? o.material[0] : o.material; meshes.push({ type: o.type, skinned: !!o.isSkinnedMesh, materialType: m ? m.type : null, map: !!(m && m.map), castShadow: o.castShadow, receiveShadow: o.receiveShadow }); });
  return { worldBounds: { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) }, boundsNote: "geometry bounding boxes (bind pose) transformed to world space, incl. node transforms; animation deforms around them", meshes, triangles }; })()`;

const FRAME_TIMING = `new Promise((res) => { const times = []; let last = performance.now(); const t0 = last; const f = (t) => { times.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { times.shift(); times.sort((a, b) => a - b); const mean = times.reduce((s, v) => s + v, 0) / times.length;
  res({ frames: times.length, fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2), note: "headless Chrome on the host GPU, usually vsync-capped — a relative indicator only, never a device measurement" }); } }; requestAnimationFrame(f); })`;

const AVATAR = `(() => { const p = globalThis.$space?.components.byId("player"); return p ? { x: p.position.x, y: p.position.y, z: p.position.z } : null; })()`;
const MEASURES = `performance.getEntriesByType("measure").filter((m) => m.name.startsWith("nrvna:")).map((m) => ({ name: m.name, ms: +m.duration.toFixed(1) }))`;

/** @param {CDP} cdp */
async function frameInfo(cdp) {
  await sleep(400);
  return cdp.eval(RENDERER);
}

/**
 * @param {CDP} cdp
 * @param {string} name
 */
async function screenshot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `perf-${stamp}-${name}.png`);
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

// ------------------------------------------------------------------------------------ per profile
/**
 * @param {string} base
 * @param {Profile} profile
 */
async function probeProfile(base, profile) {
  log("profile", profile.name);
  const cdp = await newPage(CDP_PORT);
  const requests = trackNetwork(cdp);
  await cdp.send("Network.clearBrowserCache");
  await emulate(cdp, profile);
  const t0 = Date.now();
  await cdp.send("Page.navigate", { url: base + "/" });
  const phase = await waitFor(cdp, PLACED, { label: "world placed" });
  const readyWallMs = Date.now() - t0;
  /** @type {Record<string, any>} */
  const R = { profile, phase };
  if (ASSET_COMPONENT) {
    await waitFor(cdp, ASSET_LOADED(ASSET_COMPONENT), { timeout: 60_000, label: `asset ${ASSET_COMPONENT} loaded` });
    R.assetLoadedWallMs = Date.now() - t0;
  }
  await cdp.eval(WRAP_RENDERER);
  await sleep(1200); // settle: static shadow refresh, first animation frames

  R.network = { cold: summarizeNetwork(requests) };
  R.runtime = {
    readyWallMs, readyNote: "wall time from Page.navigate to the placed world (environment-specific)",
    heap: await cdp.send("Runtime.getHeapUsage"), heapNote: "JS heap only (Runtime.getHeapUsage); GPU memory (textures, buffers) is not measured",
    measures: await cdp.eval(MEASURES),
  };
  // Launch shell: a production visitor sees no engineering presentation (diagnostics gate off).
  R.visitorShell = await cdp.eval(`(() => ({ debugNodes: document.querySelectorAll("[data-debug]").length, header: document.querySelector("header[data-app-phase]")?.innerText ?? null, prototypeText: /prototype|phase:/i.test(document.body.innerText) }))()`);
  check(`${profile.name}: visitor shell shows no diagnostics (no [data-debug], no prototype / phase text)`, R.visitorShell.debugNodes === 0 && !R.visitorShell.prototypeText, R.visitorShell);
  R.renderer = await frameInfo(cdp);
  R.scene = await cdp.eval(SCENE);
  R.frameTiming = await cdp.eval(FRAME_TIMING);
  R.screenshot = await screenshot(cdp, `${profile.name}-spawn`);

  if (ASSET_COMPONENT) {
    R.asset = await cdp.eval(ASSET(ASSET_COMPONENT));
    // Incremental cost of the asset: the same frame with and without it.
    await cdp.eval(`globalThis.$space.components.byId(${JSON.stringify(ASSET_COMPONENT)}).visible = false`);
    const without = await frameInfo(cdp);
    await cdp.eval(`globalThis.$space.components.byId(${JSON.stringify(ASSET_COMPONENT)}).visible = true`);
    const withAsset = await frameInfo(cdp);
    R.asset.incremental = withAsset.frame && without.frame
      ? { drawCalls: withAsset.frame.calls - without.frame.calls, triangles: withAsset.frame.triangles - without.frame.triangles, note: "per-frame renderer.info delta with the asset hidden vs shown (incl. its shadow-map passes when lit)" }
      : { unsupported: "no frame info" };
  }

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

  // Travel Hub → Music → Hub through the directory (DOM click). Leaving the Hub retires its chunk.
  const retireStartIndex = cdp.errors.length;
  /** @param {string} id */
  const travel = async (id) => {
    await cdp.eval(`(() => { const open = document.querySelector('[data-panel-toggle="open"]'); if (open) open.click(); return true; })()`);
    await sleep(300);
    const start = Date.now();
    await cdp.eval(`document.querySelector('a[data-destination-id="${id}"]').click()`);
    // Wait for the terminal banner (the intermediate "loadingChunk" banner is not an outcome).
    const banner = await waitFor(cdp, `(() => { const p = document.querySelector("[data-phase]")?.getAttribute("data-phase"); return p && p !== "loadingChunk" ? p : null; })()`, { timeout: 20_000, every: 50, label: "travel outcome banner" });
    const wallMs = Date.now() - start;
    await cdp.eval(`(() => { const ok = document.querySelector("[data-phase] button"); if (ok) ok.click(); return true; })()`);
    await sleep(300);
    return { banner, wallMs };
  };
  R.travel = { hubToMusic: await travel(MUSIC_ID), musicToHub: await travel(HUB_ID), note: "wall time of a DOM-click travel to the terminal banner (environment-specific)" };
  if (ASSET_COMPONENT) await waitFor(cdp, ASSET_LOADED(ASSET_COMPONENT), { timeout: 30_000, label: "asset re-staged after returning to the Hub" });
  R.runtime.heapAfterTravel = await cdp.send("Runtime.getHeapUsage");

  // Warm reload: every immutable response of the cold load that is requested again must be a cache hit.
  requests.clear();
  await cdp.send("Page.reload", {});
  await waitFor(cdp, PLACED, { label: "world placed (warm)" });
  if (ASSET_COMPONENT) await waitFor(cdp, ASSET_LOADED(ASSET_COMPONENT), { timeout: 60_000, label: "asset loaded (warm)" });
  await sleep(800);
  R.network.warmReload = summarizeNetwork(requests);
  const consoleErrors = splitConsoleErrors(cdp.errors, retireStartIndex);
  R.errors = consoleErrors.unexpected;
  R.knownEngineConsoleErrors = consoleErrors.known;
  cdp.close();

  const cold = R.network.cold;
  const warm = R.network.warmReload;
  const coldImmutable = new Set(cold.immutable.map((/** @type {{url:string}} */ r) => r.url));
  const warmRepeat = [...requests.values()].filter((r) => coldImmutable.has(pathOf(r.url)));
  check(`${profile.name}: world placed`, ["ready", "arrived", "gateRequired"].includes(phase), phase);
  check(`${profile.name}: no HTTP error responses (cold, warm)`, cold.httpErrors.length === 0 && warm.httpErrors.length === 0, [...cold.httpErrors, ...warm.httpErrors]);
  check(`${profile.name}: no failed requests (cold, warm)`, cold.failed.length === 0 && warm.failed.length === 0, [...cold.failed, ...warm.failed]);
  check(`${profile.name}: the cold load has immutable content-addressed responses`, coldImmutable.size > 0, cold.immutable.length);
  check(`${profile.name}: warm reload re-requests immutable responses and serves every one from cache`, warmRepeat.length > 0 && warmRepeat.every((r) => (r.fromDiskCache || r.fromMemoryCache) && r.wireBytes < 1024), warmRepeat.map((r) => ({ url: pathOf(r.url), disk: r.fromDiskCache, memory: r.fromMemoryCache, wire: r.wireBytes })));
  check(`${profile.name}: travel Hub → Music → Hub arrives`, R.travel.hubToMusic.banner === "arrived" && R.travel.musicToHub.banner === "arrived", R.travel);
  if (!profile.touch) check(`${profile.name}: keyboard movement moves the avatar`, R.movement.keyboardBackwardMeters > 0.1, R.movement);
  if (ASSET_COMPONENT) {
    const art = cold.art;
    check(`${profile.name}: asset GLB fetched exactly once, 200, immutable`, art.length === 1 && art[0].status === 200 && /immutable/.test(art[0].cacheControl ?? ""), art);
    check(`${profile.name}: asset rendered (mesh present, draw calls added)`, R.asset && R.asset.meshes.length > 0 && typeof R.asset.incremental.drawCalls === "number" && R.asset.incremental.drawCalls > 0, R.asset?.incremental);
    check(`${profile.name}: warm reload serves the asset GLB from cache with no wire bytes`, warm.art.length === 1 && (warm.art[0].fromDiskCache || warm.art[0].fromMemoryCache) && warm.art[0].wireBytes < 1024, warm.art);
  } else {
    check(`${profile.name}: no runtime art requested (no asset under test)`, cold.art.length === 0, cold.art);
  }
  check(`${profile.name}: no unexpected console errors (known engine defects only after a chunk retire)`, R.errors.length === 0, R.errors);
  if (Object.keys(R.knownEngineConsoleErrors).length) log(`  note ${profile.name}: known engine console errors`, JSON.stringify(R.knownEngineConsoleErrors));
  return R;
}

// ------------------------------------------------------------------------------------ main
if (!CHROME) {
  console.error("Chrome not found: set CHROME_PATH.");
  process.exit(2);
}
/** @type {{ base: string, child: import("node:child_process").ChildProcess | null, external: boolean } | null} */
let server = null;
/** @type {{ child: import("node:child_process").ChildProcess, profileDir: string } | null} */
let chrome = null;
try {
  server = await startServer(PORT);
  results.server = { base: server.base, external: server.external, note: server.external ? "BASE_URL: an already-running server — not verified to be a production build of this tree" : "next start on the local production build" };
  if (!server.external) {
    results.build = buildFreshness();
    check("production build is newer than every app source / public / config file", results.build.newerSources.length === 0, results.build.newerSources.slice(0, 20));
  }
  chrome = await launchChrome(CHROME, CDP_PORT);
  log("server", server.base, ASSET_COMPONENT ? `asset under test: ${ASSET_COMPONENT}` : "no asset under test (baseline)");
  for (const profile of PROFILES) {
    try {
      results.profiles[profile.name] = await probeProfile(server.base, profile);
    } catch (e) {
      check(`${profile.name}: probe ran to completion`, false, String(e instanceof Error ? e.stack : e).slice(0, 500));
    }
    save();
  }
} catch (e) {
  check("probe environment started", false, String(e instanceof Error ? e.message : e));
} finally {
  killTree(chrome?.child);
  killTree(server?.child);
  await removeDir(chrome?.profileDir);
}
results.notes.push(
  "Measurements only — no budget is enforced here. Asset warning bands are investigation triggers in the asset gate.",
  "Frame timing and wall times come from headless Chrome on the host machine: relative indicators, never phone measurements; the mobile profile is an emulation.",
  "renderer frame calls / triangles are per-frame cumulative renderer.info including shadow-map passes.",
);
results.failures = failures;
results.finishedAt = new Date().toISOString();
save();
log(failures.length ? `FAILED (${failures.length})` : "PASSED", "->", outFile);
for (const f of failures) log("  -", f);
process.exitCode = failures.length ? 1 : 0;
