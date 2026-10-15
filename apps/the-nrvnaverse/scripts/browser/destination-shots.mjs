// @ts-check
// Visual evidence: one real-engine screenshot per ungated destination, each reached by its deep link,
// against the production build (`pnpm --filter the-nrvnaverse build` first).
//
//   pnpm --filter the-nrvnaverse browser:shots            # desktop 1280x800
//   OUT_DIR=<dir> PORT=<port> ... browser:shots
//
// Evidence only: nothing is asserted beyond "the world was placed"; PNGs land in OUT_DIR (default: OS
// temp dir), never in the repository. The frame is the arrival view (desktop mouse-look needs pointer
// lock, which headless CDP does not grant, so no second angle is captured).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_DIR, CHROME, killTree, launchChrome, log, newPage, removeDir, sleep, startServer, waitFor } from "./cdp.mjs";

const PORT = Number(process.env.PORT ?? 3302);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9337);
const OUT_DIR = process.env.OUT_DIR ?? path.join(os.tmpdir(), "nrvnaverse-destination-shots");

const PLACED = `(() => { const ph = document.querySelector("header[data-app-phase]")?.getAttribute("data-app-phase"); return ph && ["ready", "arrived", "gateRequired"].includes(ph) && globalThis.__nrvnaverseInput ? ph : null; })()`;

/** Ungated destinations from the generated manifest view (stable ids, never coordinates). */
function destinations() {
  const file = path.resolve(APP_DIR, "..", "..", "packages", "nrvna-manifest", "generated", "destinations.json");
  /** @type {{ destinations: Array<{ id: string; slug?: string; gates?: unknown[] }> }} */
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return json.destinations.filter((d) => !(d.gates && d.gates.length)).map((d) => ({ id: d.id, slug: d.slug ?? d.id }));
}

/**
 * @param {import("./cdp.mjs").CDP} cdp
 * @param {string} name
 */
async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  log("shot", file);
}

async function main() {
  if (!CHROME) {
    console.error("No Chrome found: install Google Chrome or set CHROME_PATH.");
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer(PORT);
  const chrome = await launchChrome(CHROME, CDP_PORT);
  try {
    const cdp = await newPage(CDP_PORT);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const d of destinations()) {
      const url = `${server.base}/?destination=${encodeURIComponent(d.id)}`;
      log("navigate", url);
      await cdp.send("Page.navigate", { url });
      await waitFor(cdp, PLACED, { label: `placed ${d.slug}` });
      await sleep(2500);
      await shot(cdp, `${d.slug}-arrival`);
    }
    await cdp.close?.();
  } finally {
    killTree(chrome.child);
    if (server.child) killTree(server.child);
    await removeDir(chrome.profileDir);
  }
  log("done", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
