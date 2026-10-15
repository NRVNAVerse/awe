import type { ExperienceEffect } from "@/lib/spatial/spatial-index";
import type { ExperienceTrigger } from "@/lib/experience/experience-controller";

/**
 * Discovery memory (M1 experience campaign, second-pass value; D-021 cross-surface-ready).
 *
 * The world's hidden places each hold a SIGIL. Entering a hidden place "finds" its sigil; the
 * finds are remembered in the visitor's browser (localStorage — harmless, optional, never a
 * credential or a gate), and the world answers on later visits: a remembered sigil is lit instead
 * of dim, and the Hub's dormant frames wake as more places are remembered. There is no HUD, no
 * counter and no quest text; the memory is read off the world itself. Clearing site data clears it.
 *
 * Everything here is id-keyed configuration over the authored world (component ids, zone ids),
 * never coordinates; the effects are the same visibility toggles the experience layer uses and are
 * applied through the `ExperienceController` after a chunk is staged (its state-B geometry is hidden
 * on stage, so a remembered sigil can only be lit by this module). The persisted shape is tiny and
 * stable (`{ v: 1, found: [sigilKey…] }`) so a future WEB counterpart can read or share it (D-021:
 * obscurity is never access control — nothing restricted sits behind a sigil).
 */

export const DISCOVERY_STORAGE_KEY = "nrvnaverse.discovery.v1";

export interface SigilDefinition {
  /** Stable sigil key (persisted). */
  key: string;
  /** Zone whose ENTER finds the sigil (an existing experience zone of a hidden place). */
  zoneId: string;
  chunkKey: string;
  /** Visibility swap when the sigil is remembered: lit shown, dim hidden. */
  remembered: ExperienceEffect;
}

export interface MemoryRule {
  chunkKey: string;
  /** Applies when at least this many sigils are remembered. */
  atLeast: number;
  effect: ExperienceEffect;
}

export interface DiscoveryConfig {
  sigils: readonly SigilDefinition[];
  memory: readonly MemoryRule[];
}

/** The committed M1 configuration (ids verified against the generated chunks by the test suite). */
export const DISCOVERY_M1: DiscoveryConfig = Object.freeze({
  sigils: [
    { key: "centre", zoneId: "hub-core", chunkKey: "hub", remembered: { show: ["hub-core-sigil-lit"], hide: ["hub-core-sigil"] } },
    { key: "booth", zoneId: "music-booth", chunkKey: "music", remembered: { show: ["music-booth-sigil-lit"], hide: ["music-booth-sigil"] } },
    { key: "atelier", zoneId: "fashion-atelier", chunkKey: "fashion-culture", remembered: { show: ["fashion-atelier-sigil-lit"], hide: ["fashion-atelier-sigil"] } },
  ],
  memory: [
    { chunkKey: "hub", atLeast: 1, effect: { show: ["hub-dormant-1-inset-lit"] } },
    { chunkKey: "hub", atLeast: 2, effect: { show: ["hub-dormant-2-inset-lit"] } },
    { chunkKey: "hub", atLeast: 3, effect: { show: ["hub-memory-line"] } },
  ],
});

/** Minimal storage seam (the browser's `localStorage`, or an in-memory stand-in for tests / SSR). */
export interface DiscoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistedDiscovery {
  v: 1;
  found: string[];
}

export function parsePersisted(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return [];
    const record = parsed as Partial<PersistedDiscovery>;
    if (record.v !== 1 || !Array.isArray(record.found)) return [];
    return [...new Set(record.found.filter((k): k is string => typeof k === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(k)))];
  } catch {
    return [];
  }
}

export function serializePersisted(found: readonly string[]): string {
  return JSON.stringify({ v: 1, found: [...found].sort() } satisfies PersistedDiscovery);
}

export interface DiscoveryMemoryOptions {
  config?: DiscoveryConfig;
  /** Defaults to `window.localStorage` when available; absent / throwing storage degrades to session memory. */
  storage?: DiscoveryStorage | null;
  /** Applies a visibility effect to the currently staged chunk (the experience controller's `applyEffect`). */
  applyEffect: (effect: ExperienceEffect, label: string) => void;
  /** Called after a NEW find was recorded (diagnostics / UI). */
  onFound?: (sigilKey: string, found: readonly string[]) => void;
  warn?: (message: string, detail?: unknown) => void;
}

/**
 * Remembers finds and answers arrivals. `onTrigger` is fed from the experience controller's
 * trigger stream (zone enters only matter); `onArrival(chunkKey)` is called after every committed
 * arrival (the chunk's state-B geometry is hidden on stage at that point) and lights what the memory
 * says. Finding a sigil while standing in its place lights it immediately, so the find is seen.
 */
export class DiscoveryMemory {
  private readonly config: DiscoveryConfig;
  private readonly storage: DiscoveryStorage | null;
  private readonly applyEffect: DiscoveryMemoryOptions["applyEffect"];
  private readonly onFound: DiscoveryMemoryOptions["onFound"];
  private readonly warn: (message: string, detail?: unknown) => void;
  private found: Set<string>;
  private activeChunk: string | null = null;

  constructor(options: DiscoveryMemoryOptions) {
    this.config = options.config ?? DISCOVERY_M1;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.applyEffect = options.applyEffect;
    this.onFound = options.onFound;
    this.warn = options.warn ?? ((message, detail) => console.warn(`[discovery-memory] ${message}`, detail ?? ""));
    this.found = new Set(this.read());
  }

  /** Sigil keys remembered, sorted (diagnostics / tests / a future web counterpart). */
  get remembered(): string[] {
    return [...this.found].sort();
  }

  get total(): number {
    return this.config.sigils.length;
  }

  /** Feed from the experience controller: a zone ENTER of a sigil's place is a find. */
  onTrigger(trigger: ExperienceTrigger): void {
    if (trigger.kind !== "zone-enter") return;
    const sigil = this.config.sigils.find((s) => s.zoneId === trigger.id);
    if (!sigil || this.found.has(sigil.key)) return;
    this.found.add(sigil.key);
    this.write();
    // Seen at once: the sigil lights in front of the visitor; the Hub answers on the next arrival there.
    if (this.activeChunk === sigil.chunkKey) this.applyEffect(sigil.remembered, `sigil:${sigil.key}`);
    if (this.activeChunk !== null) this.applyMemory(this.activeChunk);
    try {
      this.onFound?.(sigil.key, this.remembered);
    } catch (err) {
      this.warn("found listener threw", err);
    }
  }

  /** After a committed arrival: light remembered sigils of this chunk and the memory rules that apply. */
  onArrival(chunkKey: string): void {
    this.activeChunk = chunkKey;
    for (const sigil of this.config.sigils) {
      if (sigil.chunkKey === chunkKey && this.found.has(sigil.key)) this.applyEffect(sigil.remembered, `sigil:${sigil.key}`);
    }
    this.applyMemory(chunkKey);
  }

  /** The memory rules that currently apply to a chunk (diagnostics / tests). */
  rulesFor(chunkKey: string): MemoryRule[] {
    const count = this.found.size;
    return this.config.memory.filter((rule) => rule.chunkKey === chunkKey && count >= rule.atLeast);
  }

  dispose(): void {
    this.activeChunk = null;
  }

  private applyMemory(chunkKey: string): void {
    for (const rule of this.rulesFor(chunkKey)) this.applyEffect(rule.effect, `memory:${chunkKey}:${rule.atLeast}`);
  }

  private read(): string[] {
    if (!this.storage) return [];
    try {
      return parsePersisted(this.storage.getItem(DISCOVERY_STORAGE_KEY));
    } catch (err) {
      this.warn("could not read the discovery memory; continuing without it", err);
      return [];
    }
  }

  private write(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(DISCOVERY_STORAGE_KEY, serializePersisted(this.remembered));
    } catch (err) {
      this.warn("could not persist the discovery memory; it lasts for this visit only", err);
    }
  }
}

function defaultStorage(): DiscoveryStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
