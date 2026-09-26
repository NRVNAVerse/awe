import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENERATED_FILE_NAMES, serializeView } from "../src/generate";
import { checkGeneratedViews, generateFromSource, normalizeLineEndings, writeGeneratedViews } from "../src/node/manifests-fs";

/**
 * Cross-platform behaviour of the generated-file writer/checker. The canonical serialization is
 * LF; a `core.autocrlf=true` checkout (Windows) presents the same committed files as CRLF, which
 * must not be reported as stale or rewritten. Everything runs in a temp directory so the
 * committed generated files are never touched.
 */

const views = generateFromSource();
const canonical = Object.fromEntries(GENERATED_FILE_NAMES.map((name) => [name, serializeView(views[name])]));
const toCrlf = (text: string) => text.replace(/\n/g, "\r\n");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nrvna-manifest-generated-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAll(transform: (text: string, name: string) => string) {
  for (const name of GENERATED_FILE_NAMES) writeFileSync(join(dir, name), transform(canonical[name], name), "utf8");
}

describe("normalizeLineEndings", () => {
  it("maps CRLF and lone CR to LF and changes nothing else", () => {
    expect(normalizeLineEndings("a\r\nb\rc\n")).toBe("a\nb\nc\n");
    expect(normalizeLineEndings("a\n  b\n")).toBe("a\n  b\n");
    expect(normalizeLineEndings("a \nb\n")).toBe("a \nb\n");
  });
});

describe("generated files on disk", () => {
  it("canonical LF content is up to date and unchanged", () => {
    writeAll((text) => text);
    expect(checkGeneratedViews(views, dir)).toEqual({ upToDate: true, stale: [] });
    expect(writeGeneratedViews(views, dir)).toEqual({ written: [], unchanged: [...GENERATED_FILE_NAMES] });
  });

  it("equivalent CRLF content (autocrlf checkout) is up to date", () => {
    writeAll(toCrlf);
    for (const name of GENERATED_FILE_NAMES) expect(readFileSync(join(dir, name), "utf8")).toContain("\r\n");
    expect(checkGeneratedViews(views, dir)).toEqual({ upToDate: true, stale: [] });
  });

  it("equivalent CRLF content is left untouched by writeGeneratedViews", () => {
    writeAll(toCrlf);
    expect(writeGeneratedViews(views, dir)).toEqual({ written: [], unchanged: [...GENERATED_FILE_NAMES] });
    for (const name of GENERATED_FILE_NAMES) expect(readFileSync(join(dir, name), "utf8")).toBe(toCrlf(canonical[name]));
  });

  it("a real content difference is still stale and gets rewritten as canonical LF", () => {
    writeAll((text, name) => (name === "directory.json" ? toCrlf(text.replace('"schemaVersion": 1', '"schemaVersion": 2')) : text));
    expect(checkGeneratedViews(views, dir)).toEqual({ upToDate: false, stale: ["directory.json"] });
    expect(writeGeneratedViews(views, dir)).toEqual({ written: ["directory.json"], unchanged: ["destinations.json", "web-destinations.json"] });
    expect(readFileSync(join(dir, "directory.json"), "utf8")).toBe(canonical["directory.json"]);
    expect(checkGeneratedViews(views, dir).upToDate).toBe(true);
  });

  it("does not mask whitespace or trailing-newline differences", () => {
    writeAll((text, name) => (name === "destinations.json" ? toCrlf(text).replace(/\r\n$/, "") : text));
    expect(checkGeneratedViews(views, dir).stale).toEqual(["destinations.json"]);

    writeAll((text, name) => (name === "destinations.json" ? toCrlf(text.replace('  "schemaVersion"', '   "schemaVersion"')) : text));
    expect(checkGeneratedViews(views, dir).stale).toEqual(["destinations.json"]);

    writeAll((text, name) => (name === "destinations.json" ? toCrlf(text) + "\r\n" : text));
    expect(checkGeneratedViews(views, dir).stale).toEqual(["destinations.json"]);
  });

  it("missing files are stale and get written", () => {
    expect(checkGeneratedViews(views, dir)).toEqual({ upToDate: false, stale: [...GENERATED_FILE_NAMES] });
    expect(writeGeneratedViews(views, dir).written).toEqual([...GENERATED_FILE_NAMES]);
    for (const name of GENERATED_FILE_NAMES) expect(readFileSync(join(dir, name), "utf8")).toBe(canonical[name]);
  });
});
