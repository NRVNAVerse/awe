/**
 * Runtime source of raw chunk payloads. The orchestrator asks for a chunk by key and by the
 * `dataUrl` the generated spatial index declares for it — no chunk path is hard-coded anywhere
 * in runtime logic. The source returns the raw JSON; validation (`parseChunkPayload`) is the
 * orchestrator's step so fetch and validation can be measured and failed separately.
 *
 * A request carries an `AbortSignal`: a superseded travel aborts its in-flight fetch.
 */
export interface ChunkDataRequest {
  chunkKey: string;
  dataUrl: string;
  signal: AbortSignal;
}

export interface ChunkDataSource {
  load(request: ChunkDataRequest): Promise<unknown>;
}

/** Fetches the static chunk file Next.js serves from `public/`. */
export class FetchChunkDataSource implements ChunkDataSource {
  async load({ dataUrl, signal }: ChunkDataRequest): Promise<unknown> {
    const res = await fetch(dataUrl, { headers: { accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`chunk request failed: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

/** A test payload entry: the raw payload, or a producer that may throw / reject / observe the abort signal. */
export type StaticChunkEntry = unknown | ((signal: AbortSignal) => unknown | Promise<unknown>);

/**
 * In-memory source for tests and headless tooling: `payloads` maps chunk key → entry. A missing
 * key behaves like a 404. Records every request so tests can prove what was (not) fetched.
 */
export class StaticChunkDataSource implements ChunkDataSource {
  readonly requests: Array<{ chunkKey: string; dataUrl: string }> = [];

  constructor(private readonly payloads: Record<string, StaticChunkEntry>) {}

  async load({ chunkKey, dataUrl, signal }: ChunkDataRequest): Promise<unknown> {
    this.requests.push({ chunkKey, dataUrl });
    if (signal.aborted) throw abortError();
    if (!Object.prototype.hasOwnProperty.call(this.payloads, chunkKey)) throw new Error(`chunk request failed: 404 Not Found (${dataUrl})`);
    const entry = this.payloads[chunkKey];
    return typeof entry === "function" ? (entry as (signal: AbortSignal) => unknown)(signal) : entry;
  }
}

export function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}
