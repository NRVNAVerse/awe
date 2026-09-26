/**
 * NRVNAVerse asset placement (M1.1): deliberately put a REGISTERED, production-eligible asset into
 * one destination's chunk as a `model` component that names it by `assetRef` — proposed by default,
 * written only with `--apply`.
 *
 *   asset:prepare → asset:publish → asset:register → asset:place → spatial:generate / spatial:check
 *
 * A human chooses the asset, the destination and the transform; this module validates and applies
 * exactly that. It never selects or approves art, never writes a URL (the generator resolves
 * `assetRef` through the registry and the committed storage origin), never touches another chunk,
 * and refuses gated destinations (gated chunk data is not access-controlled today, so gated art
 * would be publicly fetchable).
 *
 * Minimal source change: one component appended to the scene's `components`, one id appended to the
 * chunk's `componentIds`. Nothing else in either file moves.
 */
import { ASSET_ID_PATTERN, currentRevision, productionBlockers, validateAssetRegistry, type AssetRegistry } from "../spatial/assets.mjs";
import { generateSpatialArtifacts, validateSpatialSource, type SpatialSourceInput } from "../spatial/pipeline.mjs";
import { runtimeAssetUrl, runtimeResolutionProblem } from "../spatial/storage.mjs";

export const PLACE_REPORT_VERSION = 1;

/** Scene component ids are lower-case kebab-case (same shape as chunk keys). */
export const COMPONENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESTINATION_ID_PATTERN = /^dst_[0-9abcdefghjkmnpqrstvwxyz]{16}$/;
/** Transform bounds — generous for a world, tight enough to catch unit / typo mistakes. */
export const TRANSFORM_LIMITS = Object.freeze({ position: 10_000, rotation: 2 * Math.PI, scaleMin: 0.001, scaleMax: 1_000 });

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlacementRequest {
  assetId: string;
  destinationId: string;
  componentId: string;
  position: Vec3;
  /** Radians (the scene's convention). Default 0,0,0. */
  rotation?: Vec3;
  /** Default 1,1,1. */
  scale?: Vec3;
  /** Display name; defaults to the registered asset name. */
  name?: string;
}

export interface PlaceIssue {
  code: string;
  message: string;
}

export interface PlacementPlan {
  blockers: PlaceIssue[];
  alreadyPlaced: boolean;
  proposal: {
    assetId: string;
    revision: number;
    sha256: string;
    destinationId: string;
    destinationName: string;
    chunkKey: string;
    componentId: string;
    component: Record<string, unknown>;
    runtimeUrl: string;
  } | null;
  /** Exact source edits (file → one-line description). */
  sourceChanges: string[];
  /** Generated artifacts expected to change (+ added, - removed). */
  generatedChanges: string[];
  nextSceneText: string | null;
  nextConfigText: string | null;
  nextFiles: Record<string, string> | null;
}

const isVec3 = (v: unknown): v is Vec3 => typeof v === "object" && v !== null && ["x", "y", "z"].every((k) => typeof (v as Record<string, unknown>)[k] === "number" && Number.isFinite((v as Record<string, number>)[k]));

/** Parse `x,y,z` (or a single uniform number for scale) strictly: finite decimal numbers only. */
export function parseVec3(text: string | undefined, { uniform = false } = {}): Vec3 | null {
  if (text === undefined) return null;
  const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const parts = text.split(",").map((s) => s.trim());
  if (uniform && parts.length === 1 && num.test(parts[0])) {
    const n = Number(parts[0]);
    return { x: n, y: n, z: n };
  }
  if (parts.length !== 3 || !parts.every((p) => num.test(p))) return null;
  const [x, y, z] = parts.map(Number);
  return { x, y, z };
}

/** Append `id` to `chunkKey`'s componentIds in the config TEXT, preserving every other byte. */
function insertComponentId(configText: string, chunkKey: string, id: string): string | null {
  const keyAt = configText.indexOf(`"key": ${JSON.stringify(chunkKey)}`);
  if (keyAt < 0) return null;
  const listAt = configText.indexOf(`"componentIds": [`, keyAt);
  if (listAt < 0) return null;
  const close = configText.indexOf("]", listAt);
  const lastQuote = configText.lastIndexOf('"', close);
  if (close < 0 || lastQuote < listAt + `"componentIds": [`.length) return null; // empty list: not a shape the source uses
  const eol = configText.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = configText.lastIndexOf("\n", lastQuote) + 1;
  const indent = /^\s*/.exec(configText.slice(lineStart))![0];
  return `${configText.slice(0, lastQuote + 1)},${eol}${indent}${JSON.stringify(id)}${configText.slice(lastQuote + 1)}`;
}

function serializeLike(value: unknown, original: string): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return original.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Validate a placement request against the committed source and compute the exact change.
 * `destinations` is the generated manifest destination set (gate truth).
 */
export function planPlacement(input: { source: SpatialSourceInput; sceneText: string; configText: string; request: PlacementRequest }): PlacementPlan {
  const { source, request } = input;
  const blockers: PlaceIssue[] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  const result = (extra: Partial<PlacementPlan> = {}): PlacementPlan => ({ blockers, alreadyPlaced: false, proposal: null, sourceChanges: [], generatedChanges: [], nextSceneText: null, nextConfigText: null, nextFiles: null, ...extra });

  const config = source.config as Record<string, any>;
  const scene = source.scene as { components: Record<string, Record<string, unknown>> };
  const destinations = ((source.destinations as { destinations?: Array<Record<string, any>> })?.destinations ?? []) as Array<Record<string, any>>;

  // --- the asset: registered, production-eligible, resolvable ---
  if (typeof request.assetId !== "string" || !ASSET_ID_PATTERN.test(request.assetId)) {
    block("invalid-asset-id", `${JSON.stringify(request.assetId)} is not an asset id — placement names a registered asset, never a URL or file`);
    return result();
  }
  const registry = (source.assets ?? null) as AssetRegistry | null;
  if (typeof config.assetRegistry !== "string" || !registry) {
    block("unregistered-asset", "the spatial config declares no asset registry — run asset:register --apply first");
    return result();
  }
  for (const e of validateAssetRegistry(registry)) block("registry-invalid", `[${e.code}] ${e.path}: ${e.message}`);
  const record = registry.assets[request.assetId];
  if (!record) {
    block("unregistered-asset", `${request.assetId} is not registered`);
    return result();
  }
  const revision = currentRevision(record);
  if (!revision?.artifact) {
    block("no-artifact", `${request.assetId} revision ${record.currentRevision} has no runtime artifact`);
    return result();
  }
  if (record.usage !== "production") block("not-production", `${request.assetId} is ${JSON.stringify(record.usage)}, not production art`);
  else {
    const reasons = productionBlockers(record as unknown as Record<string, unknown>);
    if (reasons.length) block("not-production-eligible", reasons.join("; "));
  }
  const unresolved = runtimeResolutionProblem(revision.artifact.storage.backend, config.assetStorage ?? null);
  if (unresolved) block("storage-unresolved", `${revision.artifact.storage.backend}: ${unresolved}`);
  const runtimeUrl = unresolved ? "" : runtimeAssetUrl(revision.artifact.storage, config.assetStorage ?? null);

  // --- the destination → its chunk; gate truth from the manifest ---
  if (typeof request.destinationId !== "string" || !DESTINATION_ID_PATTERN.test(request.destinationId)) {
    block("unknown-destination", `${JSON.stringify(request.destinationId)} is not a destination id (dst_…)`);
    return result();
  }
  const destination = destinations.find((d) => d.id === request.destinationId);
  const placement = (config.placements as Array<{ destinationId: string; chunkKey: string }>).find((p) => p.destinationId === request.destinationId);
  if (!destination || destination.status !== "active" || !placement) {
    block("unknown-destination", `${request.destinationId} is not an active destination with a spatial placement`);
    return result();
  }
  const chunkKey = placement.chunkKey;
  const sharing = (config.placements as Array<{ destinationId: string; chunkKey: string }>).filter((p) => p.chunkKey === chunkKey).map((p) => destinations.find((d) => d.id === p.destinationId));
  const gated = sharing.filter((d) => d && Array.isArray(d.gates) && d.gates.length > 0).map((d) => d!.name as string);
  if (gated.length) block("gated-destination", `chunk "${chunkKey}" serves gated destination(s) ${gated.join(", ")}; gated chunk data is not access-controlled, so art is never placed there`);

  // --- the component ---
  if (typeof request.componentId !== "string" || !COMPONENT_ID_PATTERN.test(request.componentId) || request.componentId.length > 64) {
    block("invalid-component-id", `${JSON.stringify(request.componentId)} must be lower-case kebab-case, at most 64 characters`);
  }
  const position = request.position;
  const rotation = request.rotation ?? { x: 0, y: 0, z: 0 };
  const scale = request.scale ?? { x: 1, y: 1, z: 1 };
  const L = TRANSFORM_LIMITS;
  if (!isVec3(position) || [position.x, position.y, position.z].some((v) => Math.abs(v) > L.position)) block("invalid-transform", `position must be three finite numbers within ±${L.position}`);
  if (!isVec3(rotation) || [rotation.x, rotation.y, rotation.z].some((v) => Math.abs(v) > L.rotation)) block("invalid-transform", "rotation must be three finite radians within ±2π");
  if (!isVec3(scale) || [scale.x, scale.y, scale.z].some((v) => v < L.scaleMin || v > L.scaleMax)) block("invalid-transform", `scale must be three finite numbers in [${L.scaleMin}, ${L.scaleMax}]`);
  const name = request.name ?? record.name;
  if (typeof name !== "string" || !name.trim() || name.length > 120 || /[\u0000-\u001f]/.test(name)) block("invalid-name", "name must be 1-120 printable characters");
  if (blockers.length) return result();

  const component: Record<string, unknown> = {
    name,
    id: request.componentId,
    type: "model",
    kit: "cyber",
    assetRef: request.assetId,
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
    scale: { x: scale.x, y: scale.y, z: scale.z },
  };
  const proposal = { assetId: request.assetId, revision: record.currentRevision, sha256: revision.artifact.sha256, destinationId: request.destinationId, destinationName: String(destination.name), chunkKey, componentId: request.componentId, component, runtimeUrl };

  const existing = scene.components[request.componentId];
  const chunk = (config.chunks as Array<{ key: string; componentIds: string[] }>).find((c) => c.key === chunkKey)!;
  if (existing) {
    const listed = chunk.componentIds.includes(request.componentId);
    if (listed && JSON.stringify(existing) === JSON.stringify(component)) return result({ alreadyPlaced: true, proposal });
    block("duplicate-component", `component id "${request.componentId}" already exists${listed ? ` in chunk "${chunkKey}"` : ""} with different content; choose another id (placements are never overwritten)`);
    return result({ proposal });
  }
  const listedElsewhere = (config.chunks as Array<{ key: string; componentIds: string[] }>).find((c) => c.componentIds.includes(request.componentId));
  if (listedElsewhere) {
    block("duplicate-component", `component id "${request.componentId}" is already listed by chunk "${listedElsewhere.key}"`);
    return result({ proposal });
  }

  // --- the minimal source change, verified by re-parsing ---
  const nextScene = { ...(source.scene as Record<string, unknown>), components: { ...scene.components, [request.componentId]: component } };
  const nextSceneText = serializeLike(nextScene, input.sceneText);
  const nextConfigText = insertComponentId(input.configText, chunkKey, request.componentId);
  const expectedConfig = structuredClone(config);
  (expectedConfig.chunks as Array<{ key: string; componentIds: string[] }>).find((c) => c.key === chunkKey)!.componentIds.push(request.componentId);
  if (!nextConfigText || JSON.stringify(JSON.parse(nextConfigText)) !== JSON.stringify(expectedConfig)) {
    block("source-edit-failed", "could not append the component id to the chunk without disturbing the rest of the config");
    return result({ proposal });
  }

  // --- validate and generate; only this chunk (and the index that names it) may change ---
  const nextSource: SpatialSourceInput = { ...source, config: expectedConfig, scene: nextScene };
  const validation = validateSpatialSource(nextSource);
  if (!validation.ok) {
    for (const e of validation.errors) block("spatial-invalid", `[${e.code}] ${e.path}: ${e.message}`);
    return result({ proposal });
  }
  const before = generateSpatialArtifacts(source);
  const after = generateSpatialArtifacts(nextSource);
  const generatedChanges: string[] = [];
  for (const name of Object.keys(before.files).sort()) if (!(name in after.files)) generatedChanges.push(`- ${name}`);
  for (const name of Object.keys(after.files).sort()) {
    if (!(name in before.files)) generatedChanges.push(`+ ${name}`);
    else if (before.files[name] !== after.files[name]) generatedChanges.push(`~ ${name}`);
  }
  const allowed = new Set([before.chunkFiles[chunkKey], after.chunkFiles[chunkKey], "spatial/spatial-index.json", "static-scene.json"]);
  const unexpected = generatedChanges.map((c) => c.slice(2)).filter((n) => !allowed.has(n));
  if (unexpected.length) block("unexpected-generated-change", `placement would also change ${unexpected.join(", ")}`);

  return result({
    proposal,
    sourceChanges: [
      `spatial/source/${String(config.scene)}: + components.${request.componentId} (type model, assetRef ${request.assetId})`,
      `spatial/source/spatial-config.m0.json: + chunks[${JSON.stringify(chunkKey)}].componentIds ← "${request.componentId}"`,
    ],
    generatedChanges,
    nextSceneText: blockers.length ? null : nextSceneText,
    nextConfigText: blockers.length ? null : nextConfigText,
    nextFiles: blockers.length ? null : after.files,
  });
}
