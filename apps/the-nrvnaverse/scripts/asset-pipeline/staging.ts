/**
 * Local staging implementation of the provider-neutral {@link StorageAdapter} boundary (M1.1).
 *
 * Holds prepared bytes at their FINAL content-addressed object key under `<root>/objects/`, exactly
 * as the eventual external store will, so a later upload is a copy of `objects/**` and nothing is
 * re-keyed. Same write-once and verify semantics as a real provider: identical bytes to an existing
 * key are a no-op, different bytes are refused, and `verify` re-reads and re-hashes. It is a staging
 * area on the developer's machine — never a runtime backend, never in Git.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { storageBackend, type StorageAdapter } from "../spatial/storage.mjs";

export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * @param root staging directory
 * @param backend the registry backend the staged objects are destined for (keys are validated against it)
 */
export function localStagingAdapter(root: string, backend = "external-cas"): StorageAdapter {
  const contract = storageBackend(backend);
  if (!contract) throw new Error(`unsupported storage backend ${JSON.stringify(backend)}`);
  const objectsDir = join(root, "objects");

  const pathOf = (objectKey: string): string => {
    // The key pattern is the traversal guard: only `<prefix>/<assetId>…<digest>.<format>` is accepted.
    if (!contract.keyPattern.test(objectKey)) throw new Error(`${JSON.stringify(objectKey)} is not a ${backend} object key`);
    return join(objectsDir, ...objectKey.split("/"));
  };

  return {
    backend,
    async put(objectKey, bytes, meta) {
      const path = pathOf(objectKey);
      if (sha256Of(bytes) !== meta.sha256) throw new Error(`refusing to stage ${objectKey}: bytes do not match the declared sha256`);
      const location = relative(root, path).split("\\").join("/");
      if (existsSync(path)) {
        if (sha256Of(readFileSync(path)) === meta.sha256) return { created: false, location };
        throw new Error(`write-once violation: ${objectKey} already holds different bytes`);
      }
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.partial`;
      writeFileSync(temp, bytes);
      renameSync(temp, path);
      return { created: true, location };
    },
    async verify(objectKey, expected) {
      const path = pathOf(objectKey);
      if (!existsSync(path)) return { ok: false, problem: `${objectKey} is not staged` };
      const bytes = readFileSync(path);
      if (bytes.length !== expected.bytes) return { ok: false, problem: `${objectKey} is ${bytes.length} bytes, expected ${expected.bytes}` };
      const sha256 = sha256Of(bytes);
      if (sha256 !== expected.sha256) return { ok: false, problem: `${objectKey} has sha256 ${sha256}, expected ${expected.sha256}` };
      return { ok: true, problem: null };
    },
  };
}
