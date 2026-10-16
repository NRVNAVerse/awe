import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Material,
  ShaderMaterial,
  type Texture,
} from "three";
import { parseCityLayer, type CityLayerData, type ProxyPrimitive } from "@/lib/city/city-layer-data";

/**
 * The far-field city (M2). Renders the generated city layer (`/data/spatial/layers/city.<token>.json`)
 * as a handful of merged meshes attached to the space with the upstream `space.add(object3D)`
 * pattern. Purely visual: no colliders (walkable cells carry their own invisible colliders), no
 * components, no binary art — window light is a runtime `CanvasTexture`.
 *
 * Draw calls: roads, ground, three facade materials, structures (Ring, keel, compound, lamp posts),
 * glow (crowns, keel ring), beams, lamp points, the outer plain, plus two per visible chunk proxy.
 *
 * Chunk proxies are the low-detail stand-ins of ungated chunks; the proxy of the ACTIVE chunk is
 * hidden (`setActiveChunk`) so the real chunk never overlaps its own stand-in.
 */

const BAY = 3.2; // metres per window column
const FLOOR = 3.6; // metres per storey
const TEX_CELLS = 16; // windows per texture edge
const WALL_UV = 0.5 / 256; // a wall-margin texel (roofs, solid faces)

/** Deterministic hash → [0, 1) from integers. */
function hash01(...ints: number[]): number {
  let h = 0x811c9dc5;
  for (const n of ints) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return ((h >>> 0) % 1_000_003) / 1_000_003;
}

/** Growable interleaved geometry buffers (position, normal, color, uv). */
class GeometryBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /** A quad from four corners (counter-clockwise seen from the normal side). */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: Color, uvs?: number[][]): void {
    const base = this.vertexCount;
    for (const [i, p] of [a, b, c, d].entries()) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
      const t = uvs?.[i] ?? [WALL_UV, WALL_UV];
      this.uv.push(t[0], t[1]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A horizontal rectangle at height y (facing up). */
  rect(x0: number, z0: number, x1: number, z1: number, y: number, color: Color): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], color);
  }

  /** Raw triangles from another geometry (positions / normals transformed by `m`), one colour. */
  appendGeometry(geo: BufferGeometry, m: Matrix4, color: Color): void {
    const p = geo.getAttribute("position");
    const n = geo.getAttribute("normal");
    const index = geo.getIndex();
    const base = this.vertexCount;
    const v = new Vector3();
    const nm = new Matrix4().copy(m).invert().transpose();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix4(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(WALL_UV, WALL_UV);
    }
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    const count = this.pos.length / 3;
    g.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Box with world-scaled window UVs on the four sides; roof uses a wall texel. */
function addTower(b: GeometryBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: Color, uOff: number, vOff: number, roof: Color): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const vA = vOff + y0 / FLOOR / TEX_CELLS;
  const vB = vOff + y1 / FLOOR / TEX_CELLS;
  const side = (ax: number, az: number, bx: number, bz: number, n: number[], len: number, u0: number) => {
    const u1 = u0 + len / BAY / TEX_CELLS;
    b.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n, color, [
      [u0, vA],
      [u1, vA],
      [u1, vB],
      [u0, vB],
    ]);
  };
  side(x0, z1, x1, z1, [0, 0, 1], w, uOff); // south (+Z)
  side(x1, z1, x1, z0, [1, 0, 0], d, uOff + 0.27); // east
  side(x1, z0, x0, z0, [0, 0, -1], w, uOff + 0.53); // north
  side(x0, z0, x0, z1, [-1, 0, 0], d, uOff + 0.79); // west
  b.rect(x0, z0, x1, z1, y1, roof);
}

/**
 * Window pane rectangle (texture pixels) of window (i, j) for a facade style:
 * 0 office — ribbon glazing (wide panes, thin mullions), 1 residential — punched windows with sills,
 * 2 tower — near-full-height curtain wall. Diffuse and emissive maps share it so light sits in glass.
 */
function paneRect(style: number, i: number, j: number): [number, number, number, number] {
  const cell = 256 / TEX_CELLS;
  const x = i * cell;
  const y = j * cell;
  if (style === 0) return [x + 1, y + 4, cell - 2, cell - 8];
  if (style === 2) return [x + 1, y + 1, cell - 2, cell - 3];
  return [x + 5, y + 4, cell - 10, cell - 7];
}

/** Facade (diffuse) texture per style: wall / spandrel with darker glass. */
function facadeTexture(style: number): Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (!g) return null;
  const cell = 256 / TEX_CELLS;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = style === 2 ? "#323a46" : "#3a3d44";
  for (let i = 0; i < TEX_CELLS; i++) for (let j = 0; j < TEX_CELLS; j++) g.fillRect(...paneRect(style, i, j));
  if (style === 1) {
    // Sills and the odd balcony slab.
    g.fillStyle = "#d8d8d8";
    for (let i = 0; i < TEX_CELLS; i++) for (let j = 0; j < TEX_CELLS; j++) g.fillRect(i * cell + 4, j * cell + cell - 3, cell - 8, 2);
  } else {
    g.fillStyle = "#c9c9c9";
    for (let j = 0; j < TEX_CELLS; j++) g.fillRect(0, j * cell + cell - 2, 256, 2);
  }
  return finishTexture(new CanvasTexture(c));
}

/** Emissive texture: a fraction of the panes lit, in a style-specific light colour. */
function windowTexture(style: number): Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#000000";
  g.fillRect(0, 0, 256, 256);
  const lit = style === 2 ? 0.26 : style === 0 ? 0.46 : 0.38;
  const palettes = [
    ["#cfe6ff", "#e8f1ff", "#a9c9ff", "#fff3d6"],
    ["#ffcf86", "#ffb866", "#ffe2b0", "#ff9f5a"],
    ["#9fd8ff", "#7fb6ff", "#d6f0ff", "#ffe9c2"],
  ][style] ?? ["#ffffff"];
  for (let i = 0; i < TEX_CELLS; i++) {
    for (let j = 0; j < TEX_CELLS; j++) {
      // Whole floors tend to be lit or dark together (offices), single flats vary (residential).
      const floorBias = style === 0 ? (hash01(style, j, 76) < 0.5 ? 0.25 : -0.2) : 0;
      if (hash01(style, i, j, 77) > lit + floorBias) continue;
      g.globalAlpha = 0.5 + 0.5 * hash01(style, i, j, 78);
      g.fillStyle = palettes[Math.floor(hash01(style, i, j, 79) * palettes.length)];
      g.fillRect(...paneRect(style, i, j));
    }
  }
  g.globalAlpha = 1;
  return finishTexture(new CanvasTexture(c));
}

function finishTexture(t: CanvasTexture): Texture {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Soft round sprite for lamp points. */
function glowSprite(): Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,230,190,0.8)");
  grad.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function offsetMaterial<T extends Material>(m: T, factor: number, units: number): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = factor;
  m.polygonOffsetUnits = units;
  return m;
}

export interface CityLayerStats {
  drawCalls: number;
  triangles: number;
  buildings: number;
  lamps: number;
  proxies: string[];
}

export class CityLayer {
  readonly root = new Group();
  private readonly proxies = new Map<string, Group>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private activeChunk: string | null = null;
  readonly stats: CityLayerStats;

  constructor(input: unknown) {
    const data = parseCityLayer(input);
    this.root.name = "nrvnaverse-city-layer";
    this.root.matrixAutoUpdate = false;
    this.stats = this.build(data);
  }

  /** Hide the stand-in of the chunk that is now real; show every other one. */
  setActiveChunk(chunkKey: string | null): void {
    this.activeChunk = chunkKey;
    for (const [key, group] of this.proxies) group.visible = key !== chunkKey;
  }

  /** Local audition only: hide / show the procedural building meshes (a real city kit can be compared in their place). */
  setBuildingsVisible(visible: boolean): void {
    for (const child of this.root.children) if (child.name.startsWith("city-buildings-")) child.visible = visible;
  }

  get active(): string | null {
    return this.activeChunk;
  }

  /** Proxy keys currently shown (diagnostics). */
  get visibleProxies(): string[] {
    return [...this.proxies].filter(([, g]) => g.visible).map(([k]) => k);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.proxies.clear();
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private addMesh(geo: BufferGeometry, mat: Material, name: string, parent: Group = this.root): Mesh {
    const mesh = new Mesh(this.track(geo), this.track(mat));
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  }

  private build(d: CityLayerData): CityLayerStats {
    let drawCalls = 0;
    let triangles = 0;
    const count = (g: BufferGeometry) => {
      drawCalls++;
      triangles += (g.getIndex()?.count ?? 0) / 3;
    };
    const tmp = new Color();
    const c = (hex: string, k = 1) => new Color(hex).multiplyScalar(k);

    // --- Outer plain beyond the city (fog swallows its edge).
    const plain = new GeometryBuilder();
    plain.rect(-9000, -9000, 9000, 9000, -0.4, c("#14131a"));
    let g = plain.build();
    this.addMesh(g, new MeshLambertMaterial({ vertexColors: true }), "city-plain");
    count(g);

    // --- Roads (pushed furthest back so blocks / plots / district floors win at y = 0).
    const roads = new GeometryBuilder();
    const asphalt = c("#1b1d23");
    for (const [x0, z0, x1, z1] of d.roads) roads.rect(x0 / 10, z0 / 10, x1 / 10, z1 / 10, 0, asphalt);
    // Centre dashes inside the Ring and along the avenues (thin quads on the asphalt).
    const dash = c("#8a7a4a");
    const half = d.frame.half;
    for (let k = -Math.round(half / d.frame.pitch); k <= Math.round(half / d.frame.pitch); k++) {
      const line = k * d.frame.pitch;
      const avenue = Math.abs(k) % 3 === 0;
      if (!avenue && Math.abs(line) > d.frame.ring + 200) continue;
      for (let s = -half; s < half; s += 9) {
        const local = ((s % d.frame.pitch) + d.frame.pitch) % d.frame.pitch;
        if (local < 14 || local > d.frame.pitch - 14) continue;
        roads.rect(line - 0.15, s, line + 0.15, s + 3.5, 0.01, dash);
        roads.rect(s, line - 0.15, s + 3.5, line + 0.15, 0.01, dash);
      }
    }
    g = roads.build();
    this.addMesh(g, offsetMaterial(new MeshLambertMaterial({ vertexColors: true }), 2, 6), "city-roads");
    count(g);

    // --- Ground: blocks (pavement), parks, plots.
    const ground = new GeometryBuilder();
    const pave = c("#34363c");
    const park = c("#203528");
    for (const [x0, z0, x1, z1, kind] of d.grounds) ground.rect(x0 / 10, z0 / 10, x1 / 10, z1 / 10, 0, kind === 1 ? park : pave);
    for (const plot of d.plots) ground.rect(plot.rect[0], plot.rect[1], plot.rect[2], plot.rect[3], 0, c(plot.color));
    // Zebra crossings on the four approaches of each listed intersection.
    const zebra = c("#8f8f8a");
    for (const [x, z] of d.crossings ?? []) {
      const kx = Math.round(Math.abs(x) / d.frame.pitch);
      const kz = Math.round(Math.abs(z) / d.frame.pitch);
      const hx = kx % 3 === 0 ? 12 : 8; // half width of the road running along z at this x
      const hz = kz % 3 === 0 ? 12 : 8;
      for (const side of [-1, 1]) {
        // Crossing the x-road (stripes along x), just beyond the intersection on the z axis.
        const cz = z + side * (hz + 2.5);
        for (let s = -hx + 0.5; s < hx - 0.5; s += 1.6) ground.rect(x + s, cz - 1.6, x + s + 0.8, cz + 1.6, 0, zebra);
        const cx = x + side * (hx + 2.5);
        for (let s = -hz + 0.5; s < hz - 0.5; s += 1.6) ground.rect(cx - 1.6, z + s, cx + 1.6, z + s + 0.8, 0, zebra);
      }
    }
    g = ground.build();
    this.addMesh(g, offsetMaterial(new MeshLambertMaterial({ vertexColors: true }), 1, 3), "city-ground");
    count(g);

    // --- Buildings, one merged mesh per facade style.
    const styles = [new GeometryBuilder(), new GeometryBuilder(), new GeometryBuilder()];
    const roofs = [c("#2a2c31"), c("#3a3532"), c("#1f2a36")];
    for (const [i, t] of d.buildings.entries()) {
      const [x0, z0, x1, z1, y0, y1, col, style] = t;
      const s = Math.max(0, Math.min(2, style));
      tmp.set(d.facadeColors[col % d.facadeColors.length] ?? "#888888").multiplyScalar(0.5 + 0.25 * hash01(x0, z0, 3));
      addTower(styles[s], x0 / 10, z0 / 10, x1 / 10, z1 / 10, y0 / 10, y1 / 10, tmp.clone(), hash01(x0, z0, i & 7), Math.floor(hash01(z0, x0, 5) * TEX_CELLS) / TEX_CELLS, roofs[s]);
    }
    const emissiveColors = ["#dfeaff", "#ffc982", "#a8dcff"];
    const emissiveStrength = [0.95, 1.0, 1.15];
    for (const [s, builder] of styles.entries()) {
      if (builder.vertexCount === 0) continue;
      g = builder.build();
      const win = windowTexture(s);
      if (win) this.track(win);
      const facade = facadeTexture(s);
      if (facade) this.track(facade);
      const mat = new MeshLambertMaterial({ vertexColors: true, map: facade ?? undefined, emissiveMap: win ?? undefined, emissive: new Color(emissiveColors[s]), emissiveIntensity: win ? emissiveStrength[s] : 0 });
      this.addMesh(g, mat, `city-buildings-${s}`);
      count(g);
    }

    // --- Structures: the Ring viaduct, the gated compound shell, the Hub keel, lamp posts.
    const aviationTops: number[] = [];
    const structures = new GeometryBuilder();
    const glow = new GeometryBuilder();
    const concrete = c("#3b3c40");
    const m = new Matrix4();
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color, into = structures) => {
      const geo = boxGeometry();
      m.compose(new Vector3(cx, cy, cz), new Quaternion(), new Vector3(sx, sy, sz));
      into.appendGeometry(geo, m, color);
    };
    const R = d.ring.half;
    const deckY = d.ring.deckY;
    const rw = d.ring.width;
    for (const [axis, sign] of [["x", -1], ["x", 1], ["z", -1], ["z", 1]] as const) {
      const len = 2 * R + rw;
      const cx = axis === "x" ? sign * R : 0;
      const cz = axis === "z" ? sign * R : 0;
      box(cx, deckY, cz, axis === "x" ? rw : len, 1.4, axis === "z" ? rw : len, concrete);
      // Parapet light strips on both deck edges.
      for (const e of [-1, 1]) {
        const ex = axis === "x" ? cx + (e * rw) / 2 : 0;
        const ez = axis === "z" ? cz + (e * rw) / 2 : 0;
        box(ex, deckY + 0.95, ez, axis === "x" ? 0.25 : len, 0.18, axis === "z" ? 0.25 : len, c("#ffb35a", 1.2), glow);
      }
      for (let s = -R; s <= R; s += 40) {
        const px = axis === "x" ? cx : s;
        const pz = axis === "z" ? cz : s;
        box(px, deckY / 2, pz, 2.2, deckY, 2.2, concrete);
      }
    }
    for (const comp of d.compounds) {
      const [x0, z0, x1, z1] = comp.rect;
      const col = c(comp.color);
      const h = comp.height;
      box((x0 + x1) / 2, h / 2, z0, x1 - x0, h, 1, col);
      box((x0 + x1) / 2, h / 2, z1, x1 - x0, h, 1, col);
      box(x0, h / 2, (z0 + z1) / 2, 1, h, z1 - z0, col);
      box(x1, h / 2, (z0 + z1) / 2, 1, h, z1 - z0, col);
    }
    // Lamp posts inside the Ring (the far-field shows only their light).
    const postColor = c("#25272d");
    for (const [x, z, w] of d.lamps) if (w === 1) box(x / 10, 2.6, z / 10, 0.18, 5.2, 0.18, postColor);
    // Crown bands on the tallest towers.
    for (const t of d.buildings) {
      if (t[8] !== 1) continue;
      const [x0, z0, x1, z1, , y1] = t;
      box((x0 + x1) / 20, y1 / 10 - 1.2, (z0 + z1) / 20, (x1 - x0) / 10 + 0.3, 1.2, (z1 - z0) / 10 + 0.3, c("#ffd9a0", 1.1), glow);
    }
    // Storefronts: lit bays along the street face of buildings near the walkable region (shops at night).
    const shopColors = ["#ffcf8a", "#ffe2b8", "#bfe9f2", "#f2b8a8", "#f5e7b0", "#e8c9ff"].map((h) => c(h, 0.62));
    const shopDark = c("#141518");
    // District identity: storefronts within reach of a district plot take its colour family.
    const districtTints: Array<{ x: number; z: number; r: number; colors: Color[] }> = [];
    for (const [key, hexes] of [["music", ["#5fe0cf", "#2fb8a6", "#9ff2e6"]], ["fashion", ["#f0a898", "#d98c7a", "#ffd2c4"]]] as const) {
      const plot = d.plots.find((p) => p.key === key);
      if (plot) districtTints.push({ x: (plot.rect[0] + plot.rect[2]) / 2, z: (plot.rect[1] + plot.rect[3]) / 2, r: 150, colors: hexes.map((h) => c(h, 0.7)) });
    }
    for (const t of d.buildings) {
      const [x0d, z0d, x1d, z1d, y0] = t;
      if (y0 !== 0) continue;
      const x0 = x0d / 10;
      const z0 = z0d / 10;
      const x1 = x1d / 10;
      const z1 = z1d / 10;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (Math.max(Math.abs(cx), Math.abs(cz)) > d.frame.ring + d.frame.pitch * 1.5) continue;
      const e = 0.07;
      const sides: Array<[number, number, number, number, number[]]> = [
        [x0, z1 + e, x1, z1 + e, [0, 0, 1]],
        [x1 + e, z1, x1 + e, z0, [1, 0, 0]],
        [x1, z0 - e, x0, z0 - e, [0, 0, -1]],
        [x0 - e, z0, x0 - e, z1, [-1, 0, 0]],
      ];
      for (const [si, [ax, az, bx, bz, n]] of sides.entries()) {
        const len = Math.hypot(bx - ax, bz - az);
        const bays = Math.max(1, Math.floor(len / 4.2));
        for (let k = 0; k < bays; k++) {
          const h = hash01(x0d, z0d, si, k, 41);
          const t0 = (k + 0.08) / bays;
          const t1 = (k + 0.92) / bays;
          const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
          const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
          const tint = districtTints.find((t) => Math.hypot(cx - t.x, cz - t.z) < t.r);
          const palette = tint && hash01(x0d, z0d, si, k, 43) < 0.75 ? tint.colors : shopColors;
          const col = h < 0.66 ? palette[Math.floor(hash01(x0d, z0d, si, k, 42) * palette.length)] : shopDark;
          glow.quad([p0[0], 0.5, p0[1]], [p1[0], 0.5, p1[1]], [p1[0], 3.4, p1[1]], [p0[0], 3.4, p0[1]], n, col);
        }
      }
    }
    // Street trees: trunk + two-tier canopy (visual only; trees have no colliders).
    const trunk = c("#2b241e");
    const leaf = c("#1e3d2a");
    const leaf2 = c("#2a5138");
    for (const [xd, zd, sp] of d.trees ?? []) {
      const s = 0.8 + (sp / 100) * 0.5;
      const x = xd / 10;
      const z = zd / 10;
      box(x, 1.4 * s, z, 0.35 * s, 2.8 * s, 0.35 * s, trunk);
      const cone = cylinderGeometry(0, 2.1 * s, 3.4 * s, 6, false);
      m.compose(new Vector3(x, 4.2 * s, z), new Quaternion(), new Vector3(1, 1, 1));
      structures.appendGeometry(cone, m, leaf);
      cone.dispose();
      const cone2 = cylinderGeometry(0, 1.5 * s, 2.6 * s, 6, false);
      m.compose(new Vector3(x, 5.6 * s, z), new Quaternion(), new Vector3(1, 1, 1));
      structures.appendGeometry(cone2, m, leaf2);
      cone2.dispose();
    }
    // Rooftop plant on buildings within 900 m (AC boxes / tanks) and masts on the crowns.
    const plant = c("#2c2e33");
    /** @type {number[]} */
    const aviation: number[] = [];
    for (const [i, t] of d.buildings.entries()) {
      const [x0d, z0d, x1d, z1d, , y1d, , , crown] = t;
      const x0 = x0d / 10;
      const z0 = z0d / 10;
      const x1 = x1d / 10;
      const z1 = z1d / 10;
      const y1 = y1d / 10;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const isTop = i === d.buildings.length - 1 || d.buildings[i + 1][4] !== y1d || d.buildings[i + 1][0] < x0d - 1 || d.buildings[i + 1][0] > x1d;
      if (y1 > 80 && isTop) aviation.push(cx, y1 + (crown ? 9 : 0.8), cz);
      if (crown) box(cx, y1 + 4, cz, 0.6, 8, 0.6, plant);
      if (Math.hypot(cx, cz) > 900 || !isTop) continue;
      const w = x1 - x0;
      const dz = z1 - z0;
      const n = 1 + Math.floor(hash01(x0d, z0d, 51) * 2.5);
      for (let k = 0; k < n; k++) {
        const bx = x0 + w * (0.2 + 0.6 * hash01(x0d, z0d, k, 52));
        const bz = z0 + dz * (0.2 + 0.6 * hash01(x0d, z0d, k, 53));
        const sz = 1.6 + 2.4 * hash01(x0d, z0d, k, 54);
        box(bx, y1 + 0.8, bz, Math.min(sz, w * 0.3), 1.6, Math.min(sz * 0.8, dz * 0.3), plant);
      }
    }
    // The Hub's keel: a faceted inverted cone under the island deck.
    const k = d.keel;
    if (k) {
      const keelGeo = keelGeometry(k.radiusX, k.radiusZ, k.depth);
      m.compose(new Vector3(k.x, k.y, k.z), new Quaternion(), new Vector3(1, 1, 1));
      structures.appendGeometry(keelGeo, m, c(k.color));
      keelGeo.dispose();
      const ringGeo = ringGeometry(k.radiusX * 0.9, k.radiusZ * 0.9, 0.6);
      m.compose(new Vector3(k.x, k.y - 3.5, k.z), new Quaternion(), new Vector3(1, 1, 1));
      glow.appendGeometry(ringGeo, m, c(k.glow, 1.3));
      ringGeo.dispose();
    }
    aviationTops.push(...aviation);
    g = structures.build();
    this.addMesh(g, new MeshLambertMaterial({ vertexColors: true }), "city-structures");
    count(g);
    g = glow.build();
    this.addMesh(g, new MeshBasicMaterial({ vertexColors: true }), "city-glow");
    count(g);

    // --- Beams: translucent light columns (district beacons, the sky lift).
    const beams = new GeometryBuilder();
    for (const [x, z, y0, y1, r, color] of d.beacons) {
      const geo = beamGeometry(r, y1 - y0);
      m.compose(new Vector3(x, y0 + (y1 - y0) / 2, z), new Quaternion(), new Vector3(1, 1, 1));
      beams.appendGeometry(geo, m, c(color, 0.9));
      geo.dispose();
    }
    g = beams.build();
    this.addMesh(g, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }), "city-beams");
    count(g);

    // --- Lamp light: one points draw call for the whole city.
    const sprite = glowSprite();
    if (sprite) this.track(sprite);
    const lampPos = new Float32Array(d.lamps.length * 3);
    for (const [i, [x, z, w]] of d.lamps.entries()) {
      lampPos[i * 3] = x / 10;
      lampPos[i * 3 + 1] = w === 1 ? 5.3 : 6;
      lampPos[i * 3 + 2] = z / 10;
    }
    const lampGeo = this.track(new BufferGeometry());
    lampGeo.setAttribute("position", new BufferAttribute(lampPos, 3));
    lampGeo.computeBoundingSphere();
    const lampMat = this.track(new PointsMaterial({ size: 3.2, sizeAttenuation: true, color: new Color("#ffd49a"), map: sprite ?? undefined, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    const lamps = new Points(lampGeo, lampMat);
    lamps.name = "city-lamps";
    lamps.matrixAutoUpdate = false;
    lamps.frustumCulled = false;
    this.root.add(lamps);
    drawCalls++;

    // --- Aviation lights on the skyline (red points).
    if (aviationTops.length > 0) {
      const avGeo = this.track(new BufferGeometry());
      avGeo.setAttribute("position", new BufferAttribute(new Float32Array(aviationTops), 3));
      avGeo.computeBoundingSphere();
      const avMat = this.track(new PointsMaterial({ size: 4.5, sizeAttenuation: true, color: new Color("#ff3b30"), map: sprite ?? undefined, transparent: true, depthWrite: false, blending: AdditiveBlending }));
      const av = new Points(avGeo, avMat);
      av.name = "city-aviation";
      av.matrixAutoUpdate = false;
      av.frustumCulled = false;
      this.root.add(av);
      drawCalls++;
    }

    // --- Traffic: head / tail light streams on the avenues beyond the Ring and on the Ring viaduct,
    //     animated in the vertex shader (one draw call, no per-frame CPU work). Never inside the
    //     walkable region (it would pass through visitors).
    const traffic = buildTraffic(d);
    if (traffic) {
      this.track(traffic.geometry);
      this.track(traffic.material as ShaderMaterial);
      this.root.add(traffic);
      drawCalls++;
    }

    // --- Chunk proxies (stand-ins for every ungated chunk while it is not active).
    for (const [chunkKey, prims] of Object.entries(d.proxies)) {
      const group = new Group();
      group.name = `city-proxy-${chunkKey}`;
      group.matrixAutoUpdate = false;
      const solid = new GeometryBuilder();
      const lit = new GeometryBuilder();
      for (const p of prims) appendPrimitive(p, p[11] === 1 ? lit : solid);
      if (solid.vertexCount > 0) {
        g = solid.build();
        this.addMesh(g, new MeshLambertMaterial({ vertexColors: true }), `${group.name}-solid`, group);
        count(g);
      }
      if (lit.vertexCount > 0) {
        g = lit.build();
        this.addMesh(g, new MeshBasicMaterial({ vertexColors: true }), `${group.name}-lit`, group);
        count(g);
      }
      this.proxies.set(chunkKey, group);
      this.root.add(group);
    }

    this.root.updateMatrixWorld(true);
    return { drawCalls, triangles: Math.round(triangles), buildings: d.buildings.length, lamps: d.lamps.length, proxies: [...this.proxies.keys()] };
  }
}

let unitBox: BufferGeometry | null = null;
function boxGeometry(): BufferGeometry {
  if (!unitBox) unitBox = cuboid();
  return unitBox;
}

/** Unit cube centred on the origin (24 vertices, flat normals). */
function cuboid(): BufferGeometry {
  const b = new GeometryBuilder();
  const w = new Color(1, 1, 1);
  const h = 0.5;
  b.quad([-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], [0, 0, 1], w);
  b.quad([h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h], [0, 0, -1], w);
  b.quad([h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h], [1, 0, 0], w);
  b.quad([-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h], [-1, 0, 0], w);
  b.quad([-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h], [0, 1, 0], w);
  b.quad([-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [0, -1, 0], w);
  return b.build();
}

/** Vertical cylinder (radii top/bottom, height) centred on the origin, `segments` sides, capped. */
function cylinderGeometry(rTop: number, rBottom: number, height: number, segments: number, capped = true): BufferGeometry {
  const b = new GeometryBuilder();
  const w = new Color(1, 1, 1);
  const h = height / 2;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const n = [Math.sin(am), (rBottom - rTop) / Math.max(height, 0.001), Math.cos(am)];
    b.quad([Math.sin(a0) * rBottom, -h, Math.cos(a0) * rBottom], [Math.sin(a1) * rBottom, -h, Math.cos(a1) * rBottom], [Math.sin(a1) * rTop, h, Math.cos(a1) * rTop], [Math.sin(a0) * rTop, h, Math.cos(a0) * rTop], n, w);
    if (capped) {
      b.quad([0, h, 0], [Math.sin(a0) * rTop, h, Math.cos(a0) * rTop], [Math.sin(a1) * rTop, h, Math.cos(a1) * rTop], [0, h, 0], [0, 1, 0], w);
    }
  }
  return b.build();
}

/** Open translucent beam column. */
function beamGeometry(r: number, height: number): BufferGeometry {
  return cylinderGeometry(r, r, height, 12, false);
}

/** Thin elliptical ring band (keel glow). */
function ringGeometry(rx: number, rz: number, height: number): BufferGeometry {
  const g = cylinderGeometry(1, 1, height, 40, false);
  g.applyMatrix4(new Matrix4().makeScale(rx, 1, rz));
  return g;
}

/**
 * The island underside: an elliptical rim, then a faceted cone narrowing to a point, with a
 * deterministic jitter so it reads as rock rather than a lathe.
 */
function keelGeometry(rx: number, rz: number, depth: number): BufferGeometry {
  const b = new GeometryBuilder();
  const w = new Color(1, 1, 1);
  const seg = 18;
  const rings = [
    { y: 0, r: 1.0 },
    { y: -4, r: 0.97 },
    { y: -depth * 0.35, r: 0.72 },
    { y: -depth * 0.7, r: 0.38 },
    { y: -depth, r: 0.04 },
  ];
  const pt = (ri: number, si: number) => {
    const ring = rings[ri];
    const a = (si / seg) * Math.PI * 2;
    const j = ri === 0 || ri === rings.length - 1 ? 1 : 0.85 + 0.3 * hash01(ri, si % seg, 9);
    return [Math.sin(a) * rx * ring.r * j, ring.y + (ri > 0 && ri < rings.length - 1 ? (hash01(si % seg, ri, 4) - 0.5) * 3 : 0), Math.cos(a) * rz * ring.r * j];
  };
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let si = 0; si < seg; si++) {
      const a = pt(ri, si);
      const bq = pt(ri, si + 1);
      const cq = pt(ri + 1, si + 1);
      const dq = pt(ri + 1, si);
      const e1 = new Vector3(bq[0] - a[0], bq[1] - a[1], bq[2] - a[2]);
      const e2 = new Vector3(dq[0] - a[0], dq[1] - a[1], dq[2] - a[2]);
      const n = e2.cross(e1).normalize();
      b.quad(a, dq, cq, bq, [n.x, n.y, n.z], w);
    }
  }
  return b.build();
}

const _e = new Euler();
const _q = new Quaternion();
const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();

function appendPrimitive(p: ProxyPrimitive, into: GeometryBuilder): void {
  const [kind, x, y, z, a, b, cc, rx, ry, rz, color] = p;
  _q.setFromEuler(_e.set(rx, ry, rz));
  const col = new Color(color);
  if (kind === 0) {
    _m.compose(_p.set(x, y, z), _q, _s.set(a, b, cc));
    into.appendGeometry(boxGeometry(), _m, col);
  } else if (kind === 1) {
    const geo = cylinderGeometry(a, cc, b, 12);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    into.appendGeometry(geo, _m, col);
    geo.dispose();
  } else {
    const geo = cylinderGeometry(a * 0.7, a * 0.7, a * 1.4, 8);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    into.appendGeometry(geo, _m, col);
    geo.dispose();
  }
}

/** Lanes of moving light points: [x0, y, z0, dx, dz, length, speed, phase, red]. */
function buildTraffic(d: CityLayerData): Points | null {
  const half = d.frame.half;
  const pitch = d.frame.pitch;
  const R = d.frame.ring;
  const keepOut = R + 24;
  const lanes: Array<[number, number, number, number, number, number]> = []; // x0, y, z0, dx, dz, length
  const avenue = (k: number) => Math.abs(k) % 3 === 0;
  for (let k = -Math.round(half / pitch); k <= Math.round(half / pitch); k++) {
    if (!avenue(k)) continue;
    const c = k * pitch;
    const spans: Array<[number, number]> = Math.abs(c) <= keepOut ? [[-half, -keepOut], [keepOut, half]] : [[-half, half]];
    if (Math.abs(c) === R) continue; // the Ring avenue carries the viaduct traffic instead
    for (const [a, b] of spans) {
      for (const side of [-1, 1]) {
        // along z at x = c (+side lanes run +z, -side run -z); along x at z = c.
        lanes.push([c + side * 4, 0.9, side > 0 ? a : b, 0, side > 0 ? 1 : -1, b - a]);
        lanes.push([side > 0 ? a : b, 0.9, c + side * 4, side > 0 ? 1 : -1, 0, b - a]);
      }
    }
  }
  // The Ring viaduct: a loop each way on the deck.
  const deck = d.ring.deckY + 1.2;
  for (const side of [-1, 1]) {
    const o = side * 3;
    lanes.push([-R - o, deck, -R, 0, 1, 2 * R]);
    lanes.push([R + o, deck, R, 0, -1, 2 * R]);
    lanes.push([-R, deck, R + o, 1, 0, 2 * R]);
    lanes.push([R, deck, -R - o, -1, 0, 2 * R]);
  }
  const start: number[] = [];
  const dir: number[] = [];
  const motion: number[] = [];
  for (const [li, [x0, y, z0, dx, dz, length]] of lanes.entries()) {
    const n = Math.max(2, Math.floor(length / 38));
    const speed = 11 + 7 * hash01(li, 61);
    for (let i = 0; i < n; i++) {
      start.push(x0, y, z0);
      dir.push(dx, 0, dz);
      // [length, speed, phase, kind]: kind 0 = head lights (white), 1 = tail lights (red); a lane's
      // lights face along its direction, so half the lanes read white toward one side.
      motion.push(length, speed, hash01(li, i, 62) * length, (li + (dx + dz > 0 ? 0 : 1)) % 2);
    }
  }
  if (start.length === 0) return null;
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(start), 3));
  geo.setAttribute("dir", new BufferAttribute(new Float32Array(dir), 3));
  geo.setAttribute("motion", new BufferAttribute(new Float32Array(motion), 4));
  geo.boundingSphere = null;
  const material = new ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: 2600 } },
    vertexShader: `
      attribute vec3 dir;
      attribute vec4 motion;
      uniform float time;
      uniform float scale;
      varying float vKind;
      varying float vFade;
      void main() {
        float along = mod(motion.z + time * motion.y, motion.x);
        vec3 p = position + dir * along;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_PointSize = clamp(scale / max(dist, 1.0), 1.5, 18.0);
        vKind = motion.w;
        vFade = clamp(1.0 - dist / 2300.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vKind;
      varying float vFade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        vec3 col = mix(vec3(1.0, 0.93, 0.78), vec3(1.0, 0.22, 0.16), vKind);
        gl_FragColor = vec4(col * a * vFade, a * vFade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geo, material);
  points.name = "city-traffic";
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  points.onBeforeRender = () => {
    material.uniforms.time.value = performance.now() / 1000;
  };
  return points;
}
