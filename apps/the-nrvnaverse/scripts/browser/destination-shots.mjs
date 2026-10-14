// @ts-check
// Visual evidence: one real-engine screenshot per ungated destination, each reached by its deep link,
// against the production build (`pnpm --filter the-nrvnaverse build` first).
//
//   pnpm --filter the-nrvnaverse browser:shots            # desktop 1280x800
//   OUT_DIR=<dir> PORT=<port> ... browser:shots
//
// Also turns the camera (drag-look) for a second frame per destination so the overlooks / secondary
// structures behind the spawn are documented. Evidence only: nothing is asserted beyond "the world was
// placed"; PNGs land in OUT_DIR (default: OS temp dir), never in the repository.
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
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return json.destinations.filter((d) => !(d.gates && d.gates.length)).map((d) => ({ id: d.id, slug: d.slug ?? d.id }));
}

async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  log("shot", file);
}

async function dragLook(cdp, dx, dy) {
  // pointer-lock-free look: the app's raw touch/mouse Look path reads canvas drags
  const x = 500, y = 400;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + (dx * i) / 12, y: y + (dy * i) / 12, button: "left" });
    await sleep(16);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + dx, y: y + dy, button: "left", clickCount: 1 });
}

async function main() {
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
      await dragLook(cdp, 640, 0); // turn roughly 180°
      await sleep(600);
      await shot(cdp, `${d.slug}-behind`);
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
