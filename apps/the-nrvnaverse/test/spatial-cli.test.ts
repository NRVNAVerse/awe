import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkArtifacts, existingOutputCandidates, loadSpatialSource, removeStaleArtifacts, writeArtifacts } from "../scripts/spatial/cli.mjs";
import { OUTPUT, contentVersion, generateSpatialArtifacts, isContentAddressedOutput } from "../scripts/spatial/pipeline.mjs";

/**
 * M0 Step 2B.4B.2 — generated-output lifecycle of the spatial CLI with content-addressed names.
 *
 * `spatial:generate` must own the output set deterministically: it writes exactly the current
 * generation, removes stale content-addressed files of previous generations (a content change is a
 * NEW file name, so the old one would otherwise linger and keep serving old bytes under an
 * immutable policy), never deletes anything that is not a content-addressed output of this
 * pipeline, and a second run changes nothing. `spatial:check` fails on stale, missing and
 * unexpected files. Exercised here against a scratch directory — never the committed artifacts.
 */

const realSource = loadSpatialSource();
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function generation(mutate?: (draft: { config: Mutable; scene: Mutable }) => void) {
  const draft = structuredClone(realSource) as { config: Mutable; scene: Mutable; destinations: unknown };
  mutate?.(draft);
  return generateSpatialArtifacts(draft);
}

/** Every file under the scratch output dir, `public/data`-relative with forward slashes, sorted. */
function tree(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? tree(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))
    .sort();
}

let out: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "nrvnaverse-spatial-out-"));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

const read = (name: string) => readFileSync(join(out, name), "utf8");

describe("spatial CLI — generated-output ownership with content-addressed names", () => {
  it("first generation writes exactly the expected set; check passes; a second run writes and removes nothing", () => {
    const gen = generation();
    const first = writeArtifacts(gen.files, out);
    expect(first.written.sort()).toEqual(Object.keys(gen.files).sort());
    expect(first.unchanged).toEqual([]);
    expect(removeStaleArtifacts(gen.files, out)).toEqual({ removed: [], leftovers: [] });
    expect(tree(out)).toEqual(Object.keys(gen.files).sort()); // the working tree holds the generation and nothing else
    expect(checkArtifacts(gen.files, out)).toEqual({ upToDate: true, stale: [], unexpected: [] });

    const second = writeArtifacts(gen.files, out);
    expect(second.written).toEqual([]);
    expect(second.unchanged.sort()).toEqual(Object.keys(gen.files).sort());
    expect(removeStaleArtifacts(gen.files, out)).toEqual({ removed: [], leftovers: [] });
    expect(tree(out)).toEqual(Object.keys(gen.files).sort());
    for (const [name, text] of Object.entries(gen.files)) expect(read(name)).toBe(text);
  });

  it("CROSS-DEPLOYMENT: a Music content change writes music.<HASH_B>.json, removes music.<HASH_A>.json, and leaves every other file name and byte alone", () => {
    // Deployment A.
    const genA = generation();
    writeArtifacts(genA.files, out);
    removeStaleArtifacts(genA.files, out);
    const musicA = genA.chunkFiles.music;
    const hashA = genA.versions[musicA];
    const contentA = read(musicA);
    expect(contentVersion(contentA)).toBe(hashA);
    expect(JSON.parse(read(OUTPUT.spatialIndex)).chunks.music.dataUrl).toBe(`/data/${musicA}`);

    // Deployment B: Music physical content changes.
    const genB = generation((d) => (d.scene.components["platform-music"].position.z -= 3));
    const musicB = genB.chunkFiles.music;
    const hashB = genB.versions[musicB];
    expect(hashB).not.toBe(hashA);
    expect(musicB).not.toBe(musicA);

    // Before cleanup, check reports the situation precisely: the new name is missing, the old one is unexpected.
    const before = checkArtifacts(genB.files, out);
    expect(before.upToDate).toBe(false);
    expect(before.stale.sort()).toEqual([musicB, OUTPUT.spatialIndex, OUTPUT.compatibilityScene].sort()); // (the authored scene changed, so the compatibility scene did too)
    expect(before.unexpected).toEqual([musicA]);

    const written = writeArtifacts(genB.files, out);
    expect(written.written.sort()).toEqual([musicB, OUTPUT.spatialIndex, OUTPUT.compatibilityScene].sort()); // only the changed artifact, the version root and the compatibility scene
    // At this instant both files coexist — and the OLD name still holds the OLD bytes. Nothing ever writes B under A's name.
    expect(read(musicA)).toBe(contentA);
    expect(read(musicB)).toBe(genB.files[musicB]);
    expect(read(musicB)).not.toBe(contentA);
    expect(contentVersion(read(musicB))).toBe(hashB);

    const removed = removeStaleArtifacts(genB.files, out);
    expect(removed).toEqual({ removed: [musicA], leftovers: [] });
    expect(existsSync(join(out, musicA))).toBe(false); // policy: the stale content version is ABSENT (a request for HASH_A is a 404, never B)
    expect(checkArtifacts(genB.files, out)).toEqual({ upToDate: true, stale: [], unexpected: [] });
    expect(tree(out)).toEqual(Object.keys(genB.files).sort());

    // The new index names HASH_B and not HASH_A; unrelated chunks and the global scene keep their exact names and bytes.
    const indexB = read(OUTPUT.spatialIndex);
    expect(indexB).toContain(hashB);
    expect(indexB).not.toContain(hashA);
    for (const key of Object.keys(genA.chunkFiles).filter((k) => k !== "music")) {
      expect(genB.chunkFiles[key]).toBe(genA.chunkFiles[key]);
      expect(read(genB.chunkFiles[key])).toBe(genA.files[genA.chunkFiles[key]]);
    }
    expect(genB.globalSceneFile).toBe(genA.globalSceneFile);
    expect(read(genB.globalSceneFile)).toBe(genA.files[genA.globalSceneFile]);
    // Every content-addressed file on disk is the digest of its own bytes — the invariant the cache policy relies on.
    for (const name of tree(out)) {
      if (isContentAddressedOutput(name)) expect(name.endsWith(`.${contentVersion(read(name))}.json`), name).toBe(true);
    }
  });

  it("a stale content-addressed file that still holds its old bytes is removed (never overwritten with new bytes)", () => {
    const genA = generation();
    const genB = generation((d) => (d.scene.components["platform-music"].position.z -= 3));
    // Deployment B's working tree still carries A's music file (as after a source edit before regenerating).
    writeArtifacts(genB.files, out);
    mkdirSync(join(out, OUTPUT.chunksDir), { recursive: true });
    writeFileSync(join(out, genA.chunkFiles.music), genA.files[genA.chunkFiles.music], "utf8");
    expect(read(genA.chunkFiles.music)).toBe(genA.files[genA.chunkFiles.music]);
    const { removed, leftovers } = removeStaleArtifacts(genB.files, out);
    expect(removed).toEqual([genA.chunkFiles.music]);
    expect(leftovers).toEqual([]);
    expect(existsSync(join(out, genA.chunkFiles.music))).toBe(false);
    expect(read(genB.chunkFiles.music)).toBe(genB.files[genB.chunkFiles.music]);
  });

  it("a chunk removed from the source leaves a stale content-addressed file that generate removes and check reports", () => {
    const full = generation();
    writeArtifacts(full.files, out);
    // Drop the fashion chunk (move its components to the hub so the source stays valid; move its placements and portals too).
    const smaller = generation((d) => {
      const fashion = d.config.chunks.find((c: Mutable) => c.key === "fashion-culture");
      const hub = d.config.chunks.find((c: Mutable) => c.key === "hub");
      hub.componentIds.push(...fashion.componentIds);
      d.config.chunks = d.config.chunks.filter((c: Mutable) => c.key !== "fashion-culture");
      for (const p of d.config.placements) if (p.chunkKey === "fashion-culture") p.chunkKey = "hub";
      for (const p of d.config.portals) if (p.chunkKey === "fashion-culture") p.chunkKey = "hub";
    });
    expect(smaller.chunkKeys).toEqual(["cannabis-21", "hub", "music"]);
    // The removed chunk's file AND the previous Hub version (the Hub content grew) are stale content versions.
    const staleNames = [full.chunkFiles["fashion-culture"], full.chunkFiles.hub].sort();
    expect(smaller.chunkFiles.hub).not.toBe(full.chunkFiles.hub);
    const check = checkArtifacts(smaller.files, out);
    expect(check.unexpected).toEqual(staleNames);
    writeArtifacts(smaller.files, out);
    expect(removeStaleArtifacts(smaller.files, out)).toEqual({ removed: staleNames, leftovers: [] });
    expect(checkArtifacts(smaller.files, out)).toEqual({ upToDate: true, stale: [], unexpected: [] });
    expect(tree(out)).toEqual(Object.keys(smaller.files).sort());
  });

  it("never deletes files that are not content-addressed outputs of this pipeline — legacy names and foreign files are reported as leftovers, in place", () => {
    const gen = generation();
    writeArtifacts(gen.files, out);
    const hex = contentVersion("stale");
    const foreign: Record<string, string> = {
      "spatial/chunks/music.json": "legacy unversioned chunk (2B.4B.1 shape)\n",
      "spatial/global-scene.json": "legacy unversioned global scene\n",
      "spatial/chunks/notes.json": "someone's notes\n",
      [`spatial/chunks/Music.${hex}.json`]: "wrong case\n",
      [`spatial/chunks/music.${hex.slice(0, 31)}.json`]: "short token\n",
      [`spatial/chunks/music.${hex}.json.bak`]: "backup\n",
      [`spatial/global-scene-old.${hex}.json`]: "not the base name\n",
    };
    const outsideNamespace: Record<string, string> = {
      "spatial/readme.json": "not in the namespace at all\n",
      "static-scene.json.bak": "not in the namespace at all\n",
      "other/thing.json": "not in the namespace at all\n",
      [`spatial/other.${hex}.json`]: "hashed but not ours\n",
    };
    for (const [name, text] of Object.entries({ ...foreign, ...outsideNamespace })) {
      mkdirSync(join(out, name.slice(0, name.lastIndexOf("/"))), { recursive: true });
      writeFileSync(join(out, name), text, "utf8");
    }
    // The chunk directory and global-scene*.json are the namespace: those foreign files are reported; the rest are invisible.
    expect(existingOutputCandidates(out)).toEqual([...Object.keys(gen.files).filter(isContentAddressedOutput), ...Object.keys(foreign).filter((n) => n.endsWith(".json"))].sort());
    const check = checkArtifacts(gen.files, out);
    expect(check.upToDate).toBe(false);
    expect(check.stale).toEqual([]);
    expect(check.unexpected).toEqual(Object.keys(foreign).filter((n) => n.endsWith(".json")).sort());
    const { removed, leftovers } = removeStaleArtifacts(gen.files, out);
    expect(removed).toEqual([]); // NOTHING deleted
    expect(leftovers).toEqual(Object.keys(foreign).filter((n) => n.endsWith(".json")).sort());
    for (const [name, text] of Object.entries({ ...foreign, ...outsideNamespace })) expect(read(name), name).toBe(text); // all still there, untouched
    // A genuinely stale content-addressed file next to them IS removed, and only it. (A distinct digest: on a
    // case-insensitive file system `music.<hex>.json` would be the same file as the `Music.<hex>.json` planted above.)
    const stale = `spatial/chunks/music.${contentVersion("stale previous version")}.json`;
    writeFileSync(join(out, stale), "stale previous version\n", "utf8");
    expect(removeStaleArtifacts(gen.files, out).removed).toEqual([stale]);
    for (const [name, text] of Object.entries({ ...foreign, ...outsideNamespace })) expect(read(name), name).toBe(text);
  });

  it("check reports a hand-edited content-addressed file as stale (its bytes no longer match its name) and generate rewrites it", () => {
    const gen = generation();
    writeArtifacts(gen.files, out);
    const hub = gen.chunkFiles.hub;
    writeFileSync(join(out, hub), `${gen.files[hub]}\n`, "utf8"); // one extra byte
    expect(contentVersion(read(hub))).not.toBe(gen.versions[hub]);
    const check = checkArtifacts(gen.files, out);
    expect(check.stale).toEqual([hub]);
    expect(check.unexpected).toEqual([]);
    expect(writeArtifacts(gen.files, out).written).toEqual([hub]);
    expect(contentVersion(read(hub))).toBe(gen.versions[hub]);
    expect(checkArtifacts(gen.files, out).upToDate).toBe(true);
  });

  it("CRLF on disk is not stale; the generator itself writes LF", () => {
    const gen = generation();
    writeArtifacts(gen.files, out);
    const music = gen.chunkFiles.music;
    writeFileSync(join(out, music), gen.files[music].replace(/\n/g, "\r\n"), "utf8");
    expect(checkArtifacts(gen.files, out).stale).toEqual([]); // autocrlf checkout tolerated
    expect(writeArtifacts(gen.files, out).written).toEqual([]);
    expect(read(gen.chunkFiles.hub)).not.toContain("\r");
  });
});
