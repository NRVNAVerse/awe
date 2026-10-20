// @ts-check
// Release gate probe (M4), against the real production bundle.
//
//   pnpm --filter the-nrvnaverse build             # once, or after any app / world change
//   pnpm --filter the-nrvnaverse browser:release   # starts `next start`, drives headless Chrome over raw CDP
//
// BASE_URL reuses a running server (a hosted preview included — then the HTTP checks describe that
// host); EXPECT_DEPLOYMENT (default `production`) / EXPECT_INDEXING (default `0`) say what that
// build should be; EXPECT_WEB_PAGES=0 for a build made with NRVNA_WEB_PAGES=0 (links to the website
// root). CHECK_WEB_LINKS=1 also fetches every world → web link the world shows and fails on any
// status ≥ 400 — run it against production before a launch (it reads the live website).
// RUNS (default 3) fault-injected Hub loads per frame length. Results go to OUT_DIR.
// Exit 0 = passed, 1 = a check failed, 2 = environment missing.
//
//   H  HTTP: security headers + CSP on every surface; X-Robots-Tag / robots.txt / page robots meta
//      match the indexing decision; canonical + metadataBase are the deployment's world origin;
//      /web-context exists for public ungated ids and 404s for gated ones; cache policy of the version
//      root and a chunk; /api/health names the deployment.
//   B  desktop: fresh Hub load with ZERO CSP violations and only allow-listed request origins; travel
//      Hub → Music; a gated deep link is refused at the Hub with ZERO requests for the gated chunk.
//   R  return contract: `return=<id>` survives in-world travel in the URL; the way-back link is that
//      destination's canonical page on the deployment's website origin; the current-place link is the
//      current destination's page; an unresolvable return token is dropped.
//   A  Hub arrival: fresh loads with the FIRST physics update forced to 16 ms and 5 ms (the M4
//      Hub-fall fault injection) — the visitor stays on the deck and in the Hub, every time.
//   M  phone (390×844, touch): the Hub loads and stands; no CSP violation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR, CHROME, buildFreshness, killTree, launchChrome, log, newPage, removeDir, sleep, startServer, waitFor } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3322);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9339);
const RUNS = Number(process.env.RUNS ?? 3);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-browser-release");
const EXPECT_DEPLOYMENT = process.env.EXPECT_DEPLOYMENT ?? "production";
const EXPECT_INDEXING = process.env.EXPECT_INDEXING === "1";
const EXPECT_WEB_PAGES = process.env.EXPECT_WEB_PAGES !== "0";
const CHECK_WEB_LINKS = process.env.CHECK_WEB_LINKS === "1";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
/** The reviewed profile table, read as text so this probe has no TS dependency. */
const PROFILES = Object.fromEntries(
  [...fs.readFileSync(path.join(APP_DIR, "src/lib/deployment/deployment-profile.ts"), "utf8").matchAll(/(\w+): \{\s*worldOrigin: "([^"]+)",\s*webOrigin: "([^"]+)"/g)].map((m) => [m[1], { worldOrigin: m[2], webOrigin: m[3] }]),
);
const PROFILE = PROFILES[EXPECT_DEPLOYMENT];
const ALLOWED_ORIGINS = ["https://cdn.oncyber.xyz", "https://cyber.mypinata.cloud", "https://assets.nrvnaverse.com", "https://unpkg.com"];

const destinations = JSON.parse(fs.readFileSync(path.join(APP_DIR, "../../packages/nrvna-manifest/generated/destinations.json"), "utf8")).destinations;
const bySlug = Object.fromEntries(destinations.map((/** @type {any} */ d) => [d.slug, d]));
const HUB = bySlug["hub"];
const MUSIC = bySlug["music"];
const CLUB = bySlug["music-club"];
const GATED = destinations.filter((/** @type {any} */ d) => d.gates.length > 0);
const rebase = (/** @type {string} */ url) => (!EXPECT_WEB_PAGES ? `${PROFILE.webOrigin}/` : url.startsWith("https://www.nrvnaverse.com/") ? PROFILE.webOrigin + url.slice("https://www.nrvnaverse.com".length) : url);
/** Every world → web link seen during the run (CHECK_WEB_LINKS). @type {Set<string>} */
const seenWebLinks = new Set();

const results = /** @type {{ startedAt: string, finishedAt?: string, base?: string, external?: boolean, build?: unknown, deployment: string, checks: Record<string, Array<{ label: string, ok: boolean, detail?: unknown }>>, failures: string[] }} */ ({
  startedAt: new Date().toISOString(),
  deployment: EXPECT_DEPLOYMENT,
  checks: {},
  failures: [],
});
fs.mkdirSync(OUT_DIR, { recursive: true });
const save = () => fs.writeFileSync(path.join(OUT_DIR, "release-probe.json"), JSON.stringify(results, null, 2));
/** @param {string} check @param {string} label @param {unknown} ok @param {unknown} [detail] */
function expect(check, label, ok, detail) {
  (results.checks[check] ??= []).push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) results.failures.push(`${check}: ${label}${detail === undefined ? "" : " " + JSON.stringify(detail)}`);
  log(ok ? "  ok  " : "  FAIL", `${check}: ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
  save();
}

const PHASE = `document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase")`;
const PLACE = `document.querySelector("[data-current-destination]")?.getAttribute("data-current-destination")`;
const SETTLED = `(() => { const ph = ${PHASE}; return ph && ["ready", "arrived", "gateRequired"].includes(ph) ? ph : null; })()`;
const AVATAR_Y = `+(globalThis.$space?.components.byId("player")?.position.y ?? NaN).toFixed(2)`;
/** CSP violations from the very first byte of the document. */
const CSP_RECORDER = `(() => { const v = (globalThis.__cspViolations = []); document.addEventListener("securitypolicyviolation", (e) => v.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 160), source: e.sourceFile ? String(e.sourceFile).slice(0, 120) : null })); })()`;
/** M4 fault injection: the FIRST physics update after the simulation starts gets `dt` seconds. */
const injectFirstPhysicsDt = (/** @type {number} */ dt) =>
  `(() => { const hook = setInterval(() => { const ph = globalThis.$space?.physics; if (!ph || ph.active || typeof ph.update !== "function") return; clearInterval(hook); const orig = ph.update; let first = true; ph.update = (d, t) => { if (first && ph.active) { first = false; globalThis.__injected = { dt: d, used: ${dt} }; return orig(${dt}, t); } return orig(d, t); }; }, 1); })()`;

/**
 * @param {{ w: number, h: number, dpr: number, mobile: boolean, ua?: string }} profile
 * @param {string[]} [scripts] evaluated on every new document, in order
 */
async function open(profile, scripts = []) {
  const cdp = await newPage(CDP_PORT);
  if (profile.ua) await cdp.send("Emulation.setUserAgentOverride", { userAgent: profile.ua });
  if (profile.mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: profile.w, height: profile.h, deviceScaleFactor: profile.dpr, mobile: profile.mobile });
  for (const source of [CSP_RECORDER, ...scripts]) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
  /** @type {string[]} */
  const requests = [];
  cdp.on("Network.requestWillBeSent", (/** @type {any} */ p) => requests.push(p.request.url));
  return { cdp, requests };
}

/** @param {import("./cdp.mjs").CDP} cdp @param {string} base @param {string} query */
async function load(cdp, base, query) {
  await cdp.send("Page.navigate", { url: base + "/" + query });
  return waitFor(cdp, SETTLED, { label: "settled phase" });
}

const DESKTOP = { w: 1280, h: 800, dpr: 1, mobile: false };
const PHONE = { w: 390, h: 844, dpr: 3, mobile: true, ua: MOBILE_UA };

/** @param {string} base */
async function httpChecks(base) {
  const surfaces = ["/", `/?destination=${MUSIC.id}&from=web&return=web`, "/robots.txt", "/api/health", "/api/destinations", `/web-context/${MUSIC.id}`, "/data/spatial/spatial-index.json"];
  for (const p of surfaces) {
    const res = await fetch(base + p);
    const h = res.headers;
    expect("H", `${p} → 200`, res.status === 200, res.status);
    expect("H", `${p} security headers`, h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "SAMEORIGIN" && h.get("referrer-policy") === "strict-origin-when-cross-origin" && /frame-ancestors 'self'/.test(h.get("content-security-policy") ?? "") && !/'unsafe-eval'/.test(h.get("content-security-policy") ?? ""), { csp: (h.get("content-security-policy") ?? "").slice(0, 80) });
    const robots = h.get("x-robots-tag");
    const neverIndexed = /^\/(web-context|api|data)\//.test(p);
    expect("H", `${p} X-Robots-Tag`, EXPECT_INDEXING && !neverIndexed ? robots === null : robots === "noindex, nofollow", robots);
    expect("H", `${p} no x-powered-by`, h.get("x-powered-by") === null, h.get("x-powered-by"));
  }
  const robotsTxt = await (await fetch(base + "/robots.txt")).text();
  expect("H", "robots.txt matches the indexing decision", EXPECT_INDEXING ? /Allow: \/\n/.test(robotsTxt) && /Disallow: \/web-context\//.test(robotsTxt) : /Disallow: \/\s*$/m.test(robotsTxt) && !/Allow:/.test(robotsTxt), robotsTxt.trim());
  const html = await (await fetch(base + "/")).text();
  const meta = /<meta name="robots" content="([^"]+)"/.exec(html)?.[1] ?? null;
  expect("H", "entry page robots meta", EXPECT_INDEXING ? meta === "index, follow" : meta === "noindex, nofollow", meta);
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
  expect("H", "entry page canonical is the deployment's world origin", (canonical === PROFILE.worldOrigin || canonical === `${PROFILE.worldOrigin}/`), canonical);
  const panel = await (await fetch(base + `/web-context/${MUSIC.id}`)).text();
  const panelCanonical = /<link rel="canonical" href="([^"]+)"/.exec(panel)?.[1] ?? null;
  expect("H", "web-context panel: noindex, canonical = the web page on the deployment's website origin (none without web pages)", /<meta name="robots" content="noindex, nofollow"/.test(panel) && panelCanonical === (EXPECT_WEB_PAGES ? rebase(MUSIC.webUrl) : null), panelCanonical);
  expect("H", "web-context panel links the deployment's website, never another origin", panel.includes(`href="${rebase(MUSIC.webUrl)}"`) && (PROFILE.webOrigin === "https://www.nrvnaverse.com" || !panel.includes("https://www.nrvnaverse.com/worlds")), null);
  for (const d of GATED) {
    const res = await fetch(base + `/web-context/${d.id}`);
    const text = await res.text();
    expect("H", `gated ${d.slug}: no web-context panel (404)`, res.status === 404 && !text.includes(d.description), res.status);
  }
  const index = await (await fetch(base + "/data/spatial/spatial-index.json")).json();
  const chunk = await fetch(base + index.chunks.hub.dataUrl);
  expect("H", "cache: version root revalidated, chunk immutable", (await fetch(base + "/data/spatial/spatial-index.json")).headers.get("cache-control") === "public, max-age=0, must-revalidate" && chunk.headers.get("cache-control") === "public, max-age=31536000, immutable", chunk.headers.get("cache-control"));
  const layer = Object.values(index.layers ?? {})[0];
  if (layer) expect("H", "cache: city layer immutable", (await fetch(base + /** @type {any} */ (layer).dataUrl)).headers.get("cache-control") === "public, max-age=31536000, immutable", null);
  const health = await (await fetch(base + "/api/health")).json();
  expect("H", "/api/health names the deployment, indexing decision and web-pages flag", health.status === "ok" && health.deployment === EXPECT_DEPLOYMENT && health.indexing === EXPECT_INDEXING && health.webPages === EXPECT_WEB_PAGES, { deployment: health.deployment, indexing: health.indexing, webPages: health.webPages, release: health.release });
  return index;
}

/** @param {string[]} requests */
function foreignOrigins(requests, /** @type {string} */ base) {
  const own = new URL(base).origin;
  return [...new Set(requests.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).origin))].filter((o) => o !== own && !ALLOWED_ORIGINS.includes(o));
}

async function main() {
  if (!CHROME) {
    console.error("No Chrome found (set CHROME_PATH).");
    process.exit(2);
  }
  if (!PROFILE) {
    console.error(`Unknown EXPECT_DEPLOYMENT "${EXPECT_DEPLOYMENT}"`);
    process.exit(2);
  }
  const server = await startServer(PORT);
  results.base = server.base;
  results.external = server.external;
  if (!server.external) {
    results.build = buildFreshness();
    expect("H", "production build is not older than its sources", /** @type {any} */ (results.build).newerSources.length === 0, /** @type {any} */ (results.build).newerSources.slice(0, 5));
  }
  const { child, profileDir } = await launchChrome(CHROME, CDP_PORT);
  try {
    const index = await httpChecks(server.base);
    const gatedChunkUrls = [...new Set(GATED.map((/** @type {any} */ d) => index.destinations[d.id]?.chunkKey).filter(Boolean))].map((k) => index.chunks[k].dataUrl);

    // B — desktop fresh load, travel, gate.
    {
      const { cdp, requests } = await open(DESKTOP);
      await load(cdp, server.base, "");
      await sleep(2500);
      expect("B", "Hub loads", (await cdp.eval(PLACE)) === HUB.id, await cdp.eval(PLACE));
      await cdp.eval(`document.querySelector('a[href="?destination=${MUSIC.id}"]').click(), true`);
      await waitFor(cdp, `${PLACE} === "${MUSIC.id}"`, { label: "Music arrival" });
      await sleep(1500);
      expect("B", "travel Hub → Music arrives", (await cdp.eval(PLACE)) === MUSIC.id, null);
      const violations = await cdp.eval(`globalThis.__cspViolations`);
      expect("B", "zero CSP violations (load + travel)", violations.length === 0, violations.slice(0, 5));
      expect("B", "only allow-listed foreign origins requested", foreignOrigins(requests, server.base).length === 0, foreignOrigins(requests, server.base));
      expect("B", "no page errors", cdp.errors.length === 0, cdp.errors.slice(0, 3));
      cdp.close();
    }
    for (const d of GATED) {
      const { cdp, requests } = await open(DESKTOP);
      const phase = await load(cdp, server.base, `?destination=${d.id}&from=web&return=web`);
      await sleep(1500);
      expect("B", `gated ${d.slug}: refused at the Hub`, phase === "gateRequired" && (await cdp.eval(PLACE)) === HUB.id, { phase, place: await cdp.eval(PLACE) });
      const hits = requests.filter((u) => gatedChunkUrls.some((g) => u.includes(g)) || u.includes(`/web-context/${d.id}`));
      expect("B", `gated ${d.slug}: zero requests for its chunk or panel`, hits.length === 0, hits);
      cdp.close();
    }

    // R — return contract.
    {
      const { cdp } = await open(DESKTOP);
      await load(cdp, server.base, `?destination=${MUSIC.id}&from=web&return=${MUSIC.id}`);
      await sleep(1000);
      const links = () => cdp.eval(`({ current: document.querySelector('[data-web-link="current"]')?.getAttribute("href") ?? null, back: document.querySelector('[data-web-link="return"]')?.getAttribute("href") ?? null, backText: document.querySelector('[data-web-link="return"]')?.textContent ?? null })`);
      const collect = async () => { for (const h of await cdp.eval(`[...document.querySelectorAll("a[href^='http']")].map((a) => a.href)`)) if (h.startsWith(PROFILE.webOrigin)) seenWebLinks.add(h); };
      const atMusic = await links();
      await collect();
      expect("R", "at the return destination: one way back, to its canonical page on the deployment's website", atMusic.back === rebase(MUSIC.webUrl) && atMusic.current === null, atMusic);
      await cdp.eval(`document.querySelector('a[href="?destination=${CLUB.id}"]').click(), true`);
      await waitFor(cdp, `${PLACE} === "${CLUB.id}"`, { label: "Club arrival" });
      await sleep(800);
      const url = new URL(await cdp.eval("location.href"));
      expect("R", "travel keeps return=<id> in the URL (and from=spatial)", url.searchParams.get("return") === MUSIC.id && url.searchParams.get("from") === "spatial" && url.searchParams.get("destination") === CLUB.id, url.search);
      const atClub = await links();
      await collect();
      expect("R", "after travel: the current-place link is The Club's page, the way back is still Music's (one root link without web pages)", atClub.current === (EXPECT_WEB_PAGES ? rebase(CLUB.webUrl) : null) && atClub.back === rebase(MUSIC.webUrl), atClub);
      await cdp.send("Page.navigate", { url: server.base + `/?destination=${HUB.id}&from=web&return=dst_0000000000000000` });
      await waitFor(cdp, SETTLED);
      expect("R", "an unresolvable return token gives no way-back link", (await links()).back === null, await links());
      await cdp.send("Page.navigate", { url: server.base + `/?destination=${HUB.id}&from=web&return=https%3A%2F%2Fevil.example%2F` });
      await waitFor(cdp, SETTLED);
      const evil = await links();
      expect("R", "a URL as return token is refused (no open redirect)", evil.back === null && !JSON.stringify(evil).includes("evil"), evil);
      cdp.close();
    }

    if (CHECK_WEB_LINKS) {
      for (const href of seenWebLinks) {
        let status = 0;
        try {
          status = (await fetch(href, { redirect: "follow" })).status;
        } catch {}
        expect("R", `world → web link resolves: ${href}`, status > 0 && status < 400, status);
      }
    }

    // A — Hub arrival under the fault injection.
    for (const dt of [0.016, 0.005]) {
      let falls = 0;
      for (let i = 0; i < RUNS; i++) {
        const { cdp } = await open(DESKTOP, [injectFirstPhysicsDt(dt)]);
        await load(cdp, server.base, "");
        await sleep(2500);
        const y = await cdp.eval(AVATAR_Y);
        const place = await cdp.eval(PLACE);
        const injected = await cdp.eval(`globalThis.__injected ?? null`);
        if (!(y > 140 && place === HUB.id)) falls++;
        log(`    A dt=${dt} run ${i}: y=${y} place=${place} injected=${JSON.stringify(injected)}`);
        cdp.close();
      }
      expect("A", `Hub arrival with a ${dt * 1000} ms first physics frame: ${RUNS - falls} / ${RUNS} on the deck`, falls === 0, { falls, runs: RUNS });
    }

    // M — phone.
    {
      const { cdp } = await open(PHONE);
      await load(cdp, server.base, `?destination=${HUB.id}&from=web&return=web`);
      await sleep(2500);
      const y = await cdp.eval(AVATAR_Y);
      expect("M", "phone: Hub loads and the visitor stands on the deck", (await cdp.eval(PLACE)) === HUB.id && y > 140, { y });
      const violations = await cdp.eval(`globalThis.__cspViolations`);
      expect("M", "phone: zero CSP violations", violations.length === 0, violations.slice(0, 5));
      cdp.close();
    }
  } finally {
    killTree(child);
    if (server.child) killTree(server.child);
    await removeDir(profileDir);
    results.finishedAt = new Date().toISOString();
    save();
  }
  log(results.failures.length === 0 ? "release probe PASSED" : `release probe FAILED (${results.failures.length})`, "→", path.join(OUT_DIR, "release-probe.json"));
  process.exit(results.failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  results.failures.push(String(err));
  save();
  process.exit(1);
});
