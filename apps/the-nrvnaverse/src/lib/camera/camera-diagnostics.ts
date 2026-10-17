/**
 * Read-only camera snapshot for browser checks (M3 Mission A), in the same spirit as
 * `window.__nrvnaverseInput`: the production bundle hides the app's dev handles, but `pnpm
 * browser:camera` has to see which view is live, which rig follows the avatar and whether the avatar
 * is drawn. Plain copied values only — nothing here can change the camera or the preferences.
 */
export interface CameraSnapshot {
  view: "third" | "first" | null;
  /** Controls on (the world is revealed and not travelling). */
  active: boolean;
  avatarVisible: boolean | null;
  orbitActive: boolean;
  eyeActive: boolean;
  /** Requested orbit distance (metres) — the collision test may hold the camera closer. */
  orbitZoom: number | null;
  /** Camera view direction, YXZ radians. */
  yaw: number;
  pitch: number;
  camera: { x: number; y: number; z: number };
  avatar: { x: number; y: number; z: number } | null;
}

let source: (() => CameraSnapshot) | null = null;

/**
 * Point `window.__nrvnaverseCamera.snapshot()` at the live runtime (browser only; the latest runtime
 * wins). The returned function detaches this runtime (the snapshot then reads `null`).
 */
export function installCameraDiagnostics(read: () => CameraSnapshot): () => void {
  source = read;
  if (typeof window !== "undefined") {
    const target = window as typeof window & { __nrvnaverseCamera?: { snapshot: () => CameraSnapshot | null } };
    target.__nrvnaverseCamera ??= Object.freeze({ snapshot: () => (source ? source() : null) });
  }
  return () => {
    if (source === read) source = null;
  };
}
