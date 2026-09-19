import type { PlacementRegistry } from "@/lib/spatial/placement-registry";

/**
 * M0 Step 2A prototype placements for the single static scene in `public/data/static-scene.json`.
 *
 * Keys are the committed stable ids from `packages/nrvna-manifest/manifests/*.json`
 * (see docs/NRVNAVERSE_DESTINATION_MANIFEST.md §3). Coordinates are prototype layout only and
 * will change; identity will not. Keep this file and the scene JSON in sync by hand for M0 —
 * a generated spatial index may replace it later (never `portals-index.json` keyed by position).
 *
 * The gated destinations (21+ Cannabis District, NRVNA Farms Placeholder) ARE registered here so
 * that the adapter's gate check is proven against a real placement rather than a missing one:
 * the placement exists, and travel is still refused because the manifest carries `gates[]`.
 */
export const M0_WORLD_ID = "the-nrvnaverse";

export const M0_PLACEMENTS: PlacementRegistry = {
  // THE NRVNAVerse Hub
  dst_7g19n1vm9ackw8a0: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:hub",
    spawn: { position: { x: 0, y: 1, z: 6 }, yaw: 0 },
  },
  // Music District
  dst_gm3xs4a3tws7bgh3: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:music",
    spawn: { position: { x: -70, y: 1, z: 6 }, yaw: 0 },
  },
  // Placeholder Artist (in the Music District)
  dst_1qtfn9qjg9kf6jyd: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:music:artist",
    spawn: { position: { x: -70, y: 1, z: -34 }, yaw: 0 },
  },
  // Fashion / Culture District
  dst_9c4wxtpec8awsx1q: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:fashion-culture",
    spawn: { position: { x: 70, y: 1, z: 6 }, yaw: 0 },
  },
  // Placeholder Fashion / Culture Brand (in the Fashion / Culture District)
  dst_tgfh5h5jvm3wj0w7: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:fashion-culture:brand",
    spawn: { position: { x: 70, y: 1, z: -34 }, yaw: 0 },
  },
  // 21+ Cannabis District — gated (age21). Registered, never entered in M0 Step 2A.
  dst_441dtdafq3e3ehjn: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:cannabis-21",
    spawn: { position: { x: 0, y: 1, z: -114 }, yaw: 0 },
  },
  // NRVNA Farms Placeholder — gated (age21). Registered, never entered in M0 Step 2A.
  dst_vfkz626za0vra89j: {
    worldId: M0_WORLD_ID,
    placementRef: "m0:cannabis-21:nrvna-farms",
    spawn: { position: { x: 0, y: 1, z: -154 }, yaw: 0 },
  },
};
