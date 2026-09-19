import { DESTINATION_ID_ALPHABET, DESTINATION_ID_PATTERN } from "./schema";

/**
 * Generate a new stable destination id from 16 random bytes.
 *
 * Call this ONCE when authoring a new manifest, commit the result, and never
 * regenerate it. The generator never calls this — ids are read from source
 * manifests only (rule A, D-004).
 *
 * @param randomBytes 16+ random bytes. Callers on Node pass `crypto.randomBytes(16)`;
 * browsers pass `crypto.getRandomValues(new Uint8Array(16))`.
 */
export function createDestinationId(randomBytes: Uint8Array): string {
  if (randomBytes.length < 16) {
    throw new Error("createDestinationId requires at least 16 random bytes");
  }
  let body = "";
  for (let i = 0; i < 16; i++) {
    body += DESTINATION_ID_ALPHABET[randomBytes[i] % DESTINATION_ID_ALPHABET.length];
  }
  const id = `dst_${body}`;
  if (!DESTINATION_ID_PATTERN.test(id)) {
    throw new Error(`generated id does not match DESTINATION_ID_PATTERN: ${id}`);
  }
  return id;
}
