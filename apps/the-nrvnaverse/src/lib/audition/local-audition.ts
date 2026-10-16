import { Box3, Group, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * LOCAL-ONLY art audition overlay (M2, development builds only — the caller checks
 * `process.env.NODE_ENV !== "production"`, and the serving route answers 404 in production).
 *
 * `?audition=<name>` loads `/api/local-audition/overlay-<name>.json` from the owner's local
 * audition directory (`NRVNA_AUDITION_DIR`, outside the repository) and places each listed GLB in
 * the world as a purely visual object: recentred on its bounding box, standing on y = 0 (or the
 * given base), no colliders, no components, no registry, nothing persisted. This is how candidate
 * models with UNRESOLVED rights are compared in context without entering Git, a build or a deploy.
 *
 * Overlay file:
 *   { "hideCityBuildings"?: boolean, "items": [{ "file": "x.glb", "at": [x, z], "base"?: y,
 *     "scale"?: number, "rotationY"?: degrees, "label"?: string }] }
 */

export interface AuditionItem {
  file: string;
  at: [number, number];
  base?: number;
  scale?: number;
  rotationY?: number;
  label?: string;
}

export interface AuditionOverlay {
  hideCityBuildings?: boolean;
  items: AuditionItem[];
}

export interface AuditionResult {
  root: Group;
  hideCityBuildings: boolean;
  loaded: Array<{ file: string; size: [number, number, number]; triangles: number; meshes: number; ms: number }>;
  failed: Array<{ file: string; reason: string }>;
}

const NAME = /^[a-z0-9-]+$/;

export async function loadAudition(name: string, fetchImpl: typeof fetch = fetch): Promise<AuditionResult | null> {
  if (!NAME.test(name)) return null;
  const res = await fetchImpl(`/api/local-audition/overlay-${name}.json`);
  if (!res.ok) return null;
  const overlay = (await res.json()) as AuditionOverlay;
  const root = new Group();
  root.name = `local-audition-${name}`;
  const loader = new GLTFLoader();
  const result: AuditionResult = { root, hideCityBuildings: overlay.hideCityBuildings === true, loaded: [], failed: [] };
  for (const item of overlay.items ?? []) {
    const t0 = performance.now();
    try {
      if (!/^[a-z0-9-]+\.glb$/.test(item.file)) throw new Error("file must be a plain .glb name");
      const gltf = await loader.loadAsync(`/api/local-audition/${item.file}`);
      const model: Object3D = gltf.scene;
      const s = item.scale ?? 1;
      model.scale.setScalar(s);
      model.rotation.y = ((item.rotationY ?? 0) * Math.PI) / 180;
      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      model.position.set(item.at[0] - center.x, (item.base ?? 0) - box.min.y, item.at[1] - center.z);
      let triangles = 0;
      let meshes = 0;
      model.traverse((o) => {
        const mesh = o as unknown as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position: { count: number } } }; castShadow: boolean; receiveShadow: boolean };
        if (!mesh.isMesh || !mesh.geometry) return;
        meshes++;
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
      model.name = `audition-${item.file}`;
      root.add(model);
      result.loaded.push({ file: item.file, size: [round(size.x), round(size.y), round(size.z)], triangles: Math.round(triangles), meshes, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      result.failed.push({ file: item.file, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

const round = (v: number) => Math.round(v * 10) / 10;
