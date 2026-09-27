// The world: an imperative three.js scene driven by the store. Ported from the prototype;
// the visual decisions (white studio, veil glow, VSM shadows, height in the vertex shader) are kept.
import * as THREE from "three";
import type { GroupUI, Session } from "../model";
import { gamutMap, shadeOf, type Oklch } from "../lib/color";
import { HEX_R, REGION_SIZE, type XZ } from "../lib/hex";
import { heightFor, type Layout, type Lens } from "../lib/layout";
import { recencyOf } from "../lib/time";

export interface SceneInput {
  sessions: Session[]; // live ones (not archived)
  groups: Record<string, GroupUI>;
  groupOrder: string[];
  layout: Layout;
  lens: Lens;
  now: number;
  shown: Set<string>; // ids that pass the filter; when it equals all sessions nothing is dimmed
  filtering: boolean;
}
export interface EngineCallbacks {
  onPick(id: string, additive: boolean): void;
  onPickPlate(gid: string): void;
  onHover(id: string | null): void;
  onView(focusGroup: string | null, focusSession: string | null): void;
  onOpen(id: string): void;
}
interface Cell { s: Session; pos: XZ; ghostPos?: XZ; h: number; hTarget: number; slot: { mesh: THREE.InstancedMesh; i: number } | null; group: string }
interface Active { s: Session; core: THREE.Mesh; light: THREE.PointLight; spill: THREE.Mesh; haze: THREE.Mesh; hCore: { value: number }; hHaze: { value: number }; glowMat: THREE.MeshBasicMaterial; glowLo: THREE.Color; glowHi: THREE.Color; coreMat: THREE.Material }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ANGLE_45 = Math.PI / 4;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const LIGHT_TOKENS: Record<string, string> = { "--panel": "#ffffff", "--panel-2": "#eef1f4", "--border": "#d5dce3", "--text": "#1c2730", "--muted": "#5c6b78", "--accent": "#2b4e78", "--accent-ink": "#fff", "--shadow": "0 8px 30px rgba(20,30,40,.14)" };
const DARK_TOKENS: Record<string, string> = { "--panel": "#1f2b3a", "--panel-2": "#273546", "--border": "#344657", "--text": "#e8eef3", "--muted": "#93a4b5", "--accent": "#7fb0e8", "--accent-ink": "#0f1a26", "--shadow": "0 10px 36px rgba(0,0,0,.45)" };

export const threeColorOf = (col: Oklch) => { const [r, g, b] = gamutMap(col); return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace); };

function smoothNormals(geo: THREE.BufferGeometry, maxDeg: number): THREE.BufferGeometry {
  // average normals only across faces that meet at a shallow angle, so the bevel reads as a curve while the six side faces keep crisp corners
  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position, n = pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const faceN: THREE.Vector3[] = [];
  for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2); faceN.push(c.sub(b).cross(a.sub(b)).normalize().clone()); }
  const byPos = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`; (byPos.get(k) ?? byPos.set(k, []).get(k)!).push(i); }
  const cos = Math.cos((maxDeg * Math.PI) / 180), out = new Float32Array(n * 3), sum = new THREE.Vector3();
  for (const list of byPos.values()) for (const i of list) {
    const fi = faceN[(i / 3) | 0]; sum.set(0, 0, 0);
    for (const j of list) { const fj = faceN[(j / 3) | 0]; if (fi.dot(fj) > cos) sum.add(fj); }
    sum.normalize(); out[i * 3] = sum.x; out[i * 3 + 1] = sum.y; out[i * 3 + 2] = sum.z;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return geo;
}
function hexShape(radius: number) {
  const shape = new THREE.Shape();
  for (let k = 0; k < 6; k++) { const ang = (k * Math.PI) / 3, x = radius * Math.sin(ang), y = radius * Math.cos(ang); if (k) shape.lineTo(x, y); else shape.moveTo(x, y); }
  shape.closePath();
  return shape;
}
function hexPrism(radius: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(hexShape(radius), { depth: 1, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bevel, 0); // base at y = 0, top at y = 1
  return smoothNormals(geo, 32);
}
function slab(radius: number, depth: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(hexShape(radius), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -depth - bevel, 0); // top face at y = 0
  return smoothNormals(geo, 32);
}
// the real height is applied in the vertex shader so the top bevel keeps the same small radius on a tall column as on a short one
const HEIGHT_CHUNK = "\n  transformed.y = position.y < 0.5 ? position.y : position.y - 1.0 + max(hexHeight, 0.12);";
type Heightable = THREE.Material & { userData: { uHeight?: { value: number } } };
function withHeight<M extends THREE.Material>(material: M, mode: "attribute" | "uniform"): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = (mode === "attribute" ? "attribute float aHeight;\n#define hexHeight aHeight\n" : "uniform float uHeight;\n#define hexHeight uHeight\n")
      + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>" + HEIGHT_CHUNK);
    if (mode === "uniform") shader.uniforms.uHeight = (material as Heightable).userData.uHeight!;
  };
  material.customProgramCacheKey = () => "hexheight-" + mode;
  return material;
}
function environmentTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#e6ebf0"); sky.addColorStop(0.5, "#cdd5dd"); sky.addColorStop(0.62, "#aeb8c2"); sky.addColorStop(1, "#8e99a4");
  g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
  const lamp = (x: number, y: number, rx: number, ry: number, col: string) => { g.save(); g.translate(x, y); g.scale(rx, ry); const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, col); rg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore(); };
  lamp(140, 60, 120, 34, "rgba(255,255,255,0.85)"); lamp(400, 80, 80, 26, "rgba(255,250,240,0.5)");
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function spillTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!, rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  rg.addColorStop(0, "rgba(255,255,255,0.9)"); rg.addColorStop(0.35, "rgba(255,255,255,0.35)"); rg.addColorStop(0.7, "rgba(255,255,255,0.08)"); rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
/** Ray against a vertical hex column approximated by a cylinder; the distance along the ray or Infinity. */
export function rayHitColumn(o: THREE.Vector3, d: THREE.Vector3, cx: number, cz: number, r: number, h: number): number {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  let best = Infinity;
  const disc = b * b - 4 * a * c;
  if (a > 1e-9 && disc >= 0) {
    const sq = Math.sqrt(disc);
    for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
      if (t <= 0) continue;
      const y = o.y + d.y * t;
      if (y >= 0 && y <= h && t < best) best = t;
    }
  }
  if (Math.abs(d.y) > 1e-9) {
    const t = (h - o.y) / d.y;
    if (t > 0 && t < best) { const x = o.x + d.x * t - cx, z = o.z + d.z * t - cz; if (x * x + z * z <= r * r) best = t; }
  }
  return best;
}

export class WorldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private shadowFloor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private hoverRing: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private hexGeo = hexPrism(HEX_R - 0.04, 0.04);
  private plateGeo = slab(REGION_SIZE * 0.94 - 0.14, 0.28, 0.14);
  private hexMat = withHeight(new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4, envMapIntensity: 0.22 }), "attribute");
  private hexDepthMat = withHeight(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), "attribute");
  private ghostMat = withHeight(new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true, opacity: 0.28, depthWrite: false }), "attribute");
  private dimMat = withHeight(new THREE.MeshPhysicalMaterial({ roughness: 0.7, metalness: 0, clearcoat: 0, envMapIntensity: 0.15 }), "attribute");
  private spillTex = spillTexture();
  private spillGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private glow: ReturnType<WorldEngine["makeGlow"]>;
  private hexMesh: THREE.InstancedMesh | null = null;
  private dimMesh: THREE.InstancedMesh | null = null;
  private ghostMesh: THREE.InstancedMesh | null = null;
  private plates: THREE.Mesh[] = [];
  private actives: Active[] = [];
  private cells: Cell[] = [];
  private byId = new Map<string, Cell>();
  private input: SceneInput | null = null;
  private selected = new Set<string>();
  private hover: string | null = null;
  private focusGroup: string | null = null;
  private focusSession: string | null = null;
  private heightsAnimating = false;
  private tmpM = new THREE.Matrix4();
  private tmpP = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private orbit = { goal: { target: new THREE.Vector3(), theta: 0.55, phi: 0.98, radius: 78 }, cur: { target: new THREE.Vector3(), theta: 0.55, phi: 0.98, radius: 78 }, drag: null as null | { x: number; y: number; sx: number; sy: number; btn: number; shift: boolean; moved: boolean } };
  private groupLabels = new Map<string, HTMLDivElement>();
  private sessLabels = new Map<string, HTMLDivElement>();
  private placedBoxes: DOMRect[] = [];
  private last = performance.now();
  private raf = 0;
  private disposed = false;
  private world = "#f4f6f8";

  constructor(private container: HTMLElement, private labelsEl: HTMLElement, private cb: EngineCallbacks) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap; // smooth, clean penumbra instead of stepped PCF edges
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromEquirectangular(environmentTexture()).texture;
    this.scene.background = new THREE.Color(this.world);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d2da, 0.32));
    this.sun = new THREE.DirectionalLight(0xfff4e6, 1.0); this.sun.position.set(22, 38, 14); this.scene.add(this.sun);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(4096, 4096); this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.01;
    this.sun.shadow.radius = 3; this.sun.shadow.blurSamples = 12;
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35); fill.position.set(-20, 14, -18); this.scene.add(fill);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.world) })); // unlit: exactly the sky color
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.45; this.scene.add(this.ground);
    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.ShadowMaterial({ opacity: 0.22 })); // only the shadows, on top of it
    this.shadowFloor.rotation.x = -Math.PI / 2; this.shadowFloor.position.y = -0.449; this.shadowFloor.receiveShadow = true; this.scene.add(this.shadowFloor);
    this.hoverRing = new THREE.Mesh(new THREE.CylinderGeometry(HEX_R * 1.22, HEX_R * 1.22, 0.06, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color("#243140"), transparent: true, opacity: 0.85 }));
    this.hoverRing.visible = false; this.scene.add(this.hoverRing);
    this.glow = this.makeGlow();
    this.bindPointer();
    this.resize();
    this.orbit.cur.radius = this.orbit.goal.radius + 40; this.orbit.cur.phi = ANGLE_45;
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- inputs from the store
  setScene(input: SceneInput) {
    this.input = input;
    this.rebuild();
  }
  setSelection(selected: Set<string>) { this.selected = selected; this.refreshColors(); }
  setHover(id: string | null) {
    this.hover = id;
    const cell = id ? this.byId.get(id) : undefined;
    this.renderer.domElement.style.cursor = cell ? "pointer" : "";
    this.hoverRing.visible = !!cell;
    if (cell) this.hoverRing.position.set(cell.pos.x, 0.03, cell.pos.z);
  }
  setLens(lens: Lens) {
    if (!this.input) return;
    this.input = { ...this.input, lens };
    for (const c of this.cells) c.hTarget = heightFor(c.s, lens, this.input.now);
    this.heightsAnimating = true;
    this.rebuildLabelsText();
  }
  setWorldColor(hex: string) {
    this.world = hex;
    const c = new THREE.Color(hex);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear; good enough to pick a text palette
    (this.scene.background as THREE.Color).copy(c);
    this.ground.material.color.copy(c);
    this.shadowFloor.material.opacity = lum > 0.2 ? 0.22 : 0.5;
    this.container.style.setProperty("--bg", hex);
    for (const [k, v] of Object.entries(lum > 0.2 ? LIGHT_TOKENS : DARK_TOKENS)) this.container.style.setProperty(k, v);
    this.hoverRing.material.color.set(lum > 0.2 ? "#243140" : "#e8eef3");
  }
  focusGroupView(gid: string) {
    const c = this.input?.layout.centers.get(gid); if (!c) return;
    this.focusGroup = gid; this.focusSession = null;
    this.orbit.goal.target.set(c.x, 0.6, c.z);
    this.orbit.goal.radius = clamp(this.fitDistance((this.input!.layout.radius.get(gid) ?? 4) + 1.5), 15, 60);
    this.orbit.goal.phi = ANGLE_45;
    this.cb.onView(this.focusGroup, this.focusSession);
  }
  focusSessionView(id: string) {
    const cell = this.byId.get(id); if (!cell) return;
    this.focusGroup = cell.group; this.focusSession = id;
    const c = this.input!.layout.centers.get(cell.group)!;
    // look at the top of the column, from outside its region, along the line from the region's center through the column
    const vx = cell.pos.x - c.x, vz = cell.pos.z - c.z;
    if (Math.hypot(vx, vz) > 0.5) this.orbit.goal.theta = this.nearestTurn(Math.atan2(vx, vz), this.orbit.cur.theta);
    this.orbit.goal.target.set(cell.pos.x, cell.h * 0.8, cell.pos.z);
    this.orbit.goal.radius = clamp(13 + cell.h, 15, 22);
    this.orbit.goal.phi = ANGLE_45;
    this.cb.onView(this.focusGroup, this.focusSession);
  }
  viewOverview() {
    this.focusGroup = null; this.focusSession = null;
    this.orbit.goal.target.set(0, 0, 0); this.orbit.goal.radius = clamp(this.fitDistance(this.worldRadius()), 30, 220); this.orbit.goal.phi = ANGLE_45;
    this.cb.onView(null, null);
  }
  viewTop() {
    this.focusGroup = null; this.focusSession = null;
    this.orbit.goal.target.set(0, 0, 0); this.orbit.goal.radius = clamp(this.fitDistance(this.worldRadius()), 30, 220); this.orbit.goal.phi = 0.02; this.orbit.goal.theta = 0;
    this.cb.onView(null, null);
  }
  cameraTarget(): XZ { return { x: this.orbit.goal.target.x, z: this.orbit.goal.target.z }; }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.glow.setSize(w, h);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.disposeScene();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    for (const el of [...this.groupLabels.values(), ...this.sessLabels.values()]) el.remove();
  }

  // ---------------------------------------------------------------- scene
  private rebuild() {
    const input = this.input!;
    this.disposeScene();
    const { layout } = input;
    this.cells = input.sessions.filter((s) => layout.pos.has(s.id)).map((s) => {
      const prev = this.byId.get(s.id);
      return { s, pos: layout.pos.get(s.id)!, ghostPos: layout.ghostPos.get(s.id), h: prev?.h ?? 0.2, hTarget: heightFor(s, input.lens, input.now), slot: null, group: layout.displayGroup.get(s.id) ?? s.repo };
    });
    this.byId = new Map(this.cells.map((c) => [c.s.id, c]));
    const shown = input.filtering ? this.cells.filter((c) => input.shown.has(c.s.id)) : this.cells;
    const dimmed = input.filtering ? this.cells.filter((c) => !input.shown.has(c.s.id)) : [];
    this.hexMesh = this.makeBatch(shown, this.hexMat, this.hexDepthMat, true);
    this.dimMesh = this.makeBatch(dimmed, this.dimMat, null, false); // filtered out: pale solid columns that cast no shadow
    this.heightsAnimating = true;

    const ghosts = this.cells.filter((c) => c.ghostPos);
    if (ghosts.length) {
      const m = new THREE.InstancedMesh(this.heightGeometry(ghosts.length), this.ghostMat, ghosts.length);
      (m.geometry.attributes.aHeight.array as Float32Array).fill(0.3);
      ghosts.forEach((c, i) => { this.tmpM.makeTranslation(c.ghostPos!.x, 0, c.ghostPos!.z); m.setMatrixAt(i, this.tmpM); m.setColorAt(i, threeColorOf(input.groups[c.s.repo].color)); });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.scene.add(m); this.ghostMesh = m;
    }
    for (const gid of input.groupOrder) {
      const g = input.groups[gid], center = layout.centers.get(gid);
      if (!g || !center) continue;
      const repo = g.kind === "repo";
      const plate = new THREE.Mesh(this.plateGeo, new THREE.MeshPhysicalMaterial({
        color: threeColorOf(repo ? { l: 0.78, c: g.color.c * 0.7, h: g.color.h } : { l: 0.82, c: 0.015, h: g.color.h }),
        roughness: 0.65, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.5, envMapIntensity: 0.12 }));
      plate.position.set(center.x, -0.02, center.z); plate.userData.gid = gid; plate.receiveShadow = true; plate.castShadow = true;
      this.scene.add(plate); this.plates.push(plate);
    }
    for (const c of shown.filter((c) => c.s.active)) this.addActive(c, input.groups[c.s.repo].color);
    this.fitShadowCamera();
    this.buildGroupLabels();
  }
  private addActive(c: Cell, base: Oklch) {
    // same material as every other column plus an even emissive term in the group's hue: lit like its neighbours, glowing from within
    const hCore = { value: c.h };
    const coreMat = new THREE.MeshPhysicalMaterial({ color: threeColorOf({ ...base, l: 0.7 }), emissive: threeColorOf({ ...base, l: 0.72, c: Math.max(base.c, 0.2) }), emissiveIntensity: 0.45, roughness: 0.5, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4, envMapIntensity: 0.22 });
    coreMat.userData.uHeight = hCore; withHeight(coreMat, "uniform");
    const glowLo = threeColorOf({ ...base, l: 0.5, c: Math.max(base.c, 0.22) }), glowHi = threeColorOf({ ...base, l: 0.68, c: Math.max(base.c, 0.22) });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowLo.clone() }); glowMat.userData.uHeight = hCore; withHeight(glowMat, "uniform");
    const coreDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); coreDepth.userData.uHeight = hCore; withHeight(coreDepth, "uniform");
    const core = new THREE.Mesh(this.hexGeo, coreMat);
    core.position.set(c.pos.x, 0, c.pos.z); core.castShadow = core.receiveShadow = true; core.customDepthMaterial = coreDepth;
    const light = new THREE.PointLight(threeColorOf({ ...base, l: 0.75 }), 0.5, 9, 2); light.position.set(c.pos.x, c.h + 1, c.pos.z);
    const spill = new THREE.Mesh(this.spillGeo, new THREE.MeshBasicMaterial({ map: this.spillTex, color: threeColorOf({ ...base, l: 0.7, c: Math.max(base.c, 0.2) }), transparent: true, opacity: 0.22, depthWrite: false }));
    spill.position.set(c.pos.x, 0.012, c.pos.z); spill.scale.set(5.2, 1, 5.2); spill.renderOrder = 1;
    const hHaze = { value: c.h + 0.5 };
    const hazeMat = new THREE.MeshBasicMaterial({ color: threeColorOf({ ...base, l: 0.78, c: Math.max(base.c, 0.2) }), transparent: true, opacity: 0.16, depthWrite: false }); hazeMat.userData.uHeight = hHaze; withHeight(hazeMat, "uniform");
    const haze = new THREE.Mesh(this.hexGeo, hazeMat); haze.position.set(c.pos.x, 0, c.pos.z); haze.scale.set(1.22, 1, 1.22); haze.renderOrder = 2;
    this.scene.add(core, light, spill, haze);
    this.actives.push({ s: c.s, core, light, spill, haze, hCore, hHaze, glowMat, glowLo, glowHi, coreMat });
  }
  private heightGeometry(n: number) { const g = this.hexGeo.clone(); g.setAttribute("aHeight", new THREE.InstancedBufferAttribute(new Float32Array(n), 1)); return g; }
  private makeBatch(list: Cell[], material: THREE.Material, depthMat: THREE.Material | null, shadows: boolean) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(this.heightGeometry(list.length), material, list.length);
    if (depthMat) m.customDepthMaterial = depthMat;
    list.forEach((c, i) => { c.slot = { mesh: m, i }; this.setHexMatrix(c); m.setColorAt(i, threeColorOf(this.colorForCell(c))); });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aHeight.needsUpdate = true;
    m.castShadow = m.receiveShadow = shadows;
    this.scene.add(m); return m;
  }
  // running sessions are drawn as their own self-lit meshes, so their batch instance stays collapsed
  private setHexMatrix(c: Cell) {
    if (!c.slot) return;
    const { mesh, i } = c.slot;
    if (c.s.active && mesh === this.hexMesh) { mesh.setMatrixAt(i, HIDDEN); return; }
    this.tmpM.makeTranslation(c.pos.x, 0, c.pos.z); mesh.setMatrixAt(i, this.tmpM);
    (mesh.geometry.attributes.aHeight as THREE.InstancedBufferAttribute).setX(i, c.h);
  }
  private colorForCell(c: Cell): Oklch {
    const input = this.input!, base = input.groups[c.s.repo].color;
    if (input.filtering && !input.shown.has(c.s.id)) return { l: 0.88, c: 0.006, h: base.h };
    const sh = shadeOf(base, recencyOf(c.s.lastActiveAt, input.now), c.s.active);
    if (this.selected.has(c.s.id)) { sh.l = Math.min(0.95, sh.l + 0.18); sh.c = Math.max(sh.c, 0.08); }
    return sh;
  }
  private refreshColors() {
    for (const c of this.cells) if (c.slot) c.slot.mesh.setColorAt(c.slot.i, threeColorOf(this.colorForCell(c)));
    for (const m of [this.hexMesh, this.dimMesh]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
  }
  private disposeScene() {
    for (const m of [this.hexMesh, this.dimMesh, this.ghostMesh]) if (m) { this.scene.remove(m); m.geometry.dispose(); m.dispose(); }
    this.hexMesh = this.dimMesh = this.ghostMesh = null;
    for (const p of this.plates) { this.scene.remove(p); (p.material as THREE.Material).dispose(); }
    for (const a of this.actives) { this.scene.remove(a.core, a.light, a.spill, a.haze); (a.core.material as THREE.Material).dispose(); (a.spill.material as THREE.Material).dispose(); (a.haze.material as THREE.Material).dispose(); a.glowMat.dispose(); }
    this.plates = []; this.actives = [];
  }
  private fitShadowCamera() {
    // the shadow map covers exactly the populated area, so every texel is spent where the hexes are
    const R = this.worldRadius() + 4, cam = this.sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 160;
    cam.updateProjectionMatrix();
  }
  private worldRadius() {
    let r = REGION_SIZE;
    for (const c of this.input?.layout.centers.values() ?? []) r = Math.max(r, Math.hypot(c.x, c.z) + REGION_SIZE * 0.94);
    return r;
  }
  private fitDistance(radius: number) {
    const fovV = (this.camera.fov * Math.PI) / 180, fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    return (radius / Math.sin(Math.min(fovV, fovH) / 2)) * 1.04;
  }
  private nearestTurn(target: number, current: number) {
    let d = (target - current) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    return current + d;
  }

  // ---------------------------------------------------------------- glow (selective, composited as a veil)
  private makeGlow() {
    const renderer = this.renderer, pr = renderer.getPixelRatio();
    const w = Math.max(2, (this.container.clientWidth * pr) | 0), h = Math.max(2, (this.container.clientHeight * pr) | 0);
    const opts: THREE.RenderTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, samples: 4 };
    const full = new THREE.WebGLRenderTarget(w, h, opts);
    const half: THREE.RenderTargetOptions = { ...opts, samples: 0, depthBuffer: false, type: THREE.HalfFloatType };
    const a = new THREE.WebGLRenderTarget(w >> 1, h >> 1, half), b = new THREE.WebGLRenderTarget(w >> 1, h >> 1, half);
    const blur = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, step: { value: new THREE.Vector2() } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 step; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
          c += (texture2D(tDiffuse, vUv + step*1.3846153846) + texture2D(tDiffuse, vUv - step*1.3846153846)) * 0.3162162162;
          c += (texture2D(tDiffuse, vUv + step*3.2307692308) + texture2D(tDiffuse, vUv - step*3.2307692308)) * 0.0702702703;
          gl_FragColor = c;
        }`, depthTest: false, depthWrite: false });
    // on a light background added light is invisible: the blurred glow shape becomes the alpha of a saturated veil in the group hue
    const add = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, strength: { value: 0.55 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
        void main(){
          vec4 g = texture2D(tDiffuse, vUv);
          float lum = max(g.r, max(g.g, g.b));
          vec3 hue = lum > 0.002 ? g.rgb / lum : vec3(0.0);
          gl_FragColor = vec4(mix(hue, vec3(1.0), 0.45), smoothstep(0.06, 0.7, lum) * strength);
        }`, transparent: true, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur);
    const qs = new THREE.Scene(); qs.add(quad);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const blackAttr = withHeight(new THREE.MeshBasicMaterial({ color: 0x000000 }), "attribute");
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    return {
      full, a, b, add, quad, qs, qc, blackAttr, black,
      setSize: (cw: number, ch: number) => { const p = renderer.getPixelRatio(), W = Math.max(2, (cw * p) | 0), H = Math.max(2, (ch * p) | 0); full.setSize(W, H); a.setSize(W >> 1, H >> 1); b.setSize(W >> 1, H >> 1); },
      blurPass: (src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget, dx: number, dy: number) => { blur.uniforms.tDiffuse.value = src.texture; blur.uniforms.step.value.set(dx / src.width, dy / src.height); quad.material = blur; renderer.setRenderTarget(dst); renderer.render(qs, qc); },
    };
  }
  private renderWithGlow() {
    const { renderer, scene, camera, glow } = this;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    if (!this.actives.length) return;
    const bg = scene.background; scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    const hexM = this.hexMesh?.material, ghostM = this.ghostMesh?.material;
    if (this.hexMesh) this.hexMesh.material = glow.blackAttr; if (this.ghostMesh) this.ghostMesh.material = glow.blackAttr;
    const dimV = this.dimMesh?.visible; if (this.dimMesh) this.dimMesh.visible = false;
    const plateM = this.plates.map((p) => p.material); for (const p of this.plates) p.material = glow.black;
    const groundM = this.ground.material; (this.ground as THREE.Mesh).material = glow.black; const sfV = this.shadowFloor.visible; this.shadowFloor.visible = false;
    const ringV = this.hoverRing.visible; this.hoverRing.visible = false;
    for (const a of this.actives) { a.spill.visible = a.haze.visible = false; a.core.material = a.glowMat; }
    renderer.setRenderTarget(glow.full); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
    if (this.hexMesh && hexM) this.hexMesh.material = hexM; if (this.ghostMesh && ghostM) this.ghostMesh.material = ghostM; if (this.dimMesh) this.dimMesh.visible = dimV!;
    this.plates.forEach((p, i) => (p.material = plateM[i])); (this.ground as THREE.Mesh).material = groundM; this.shadowFloor.visible = sfV; this.hoverRing.visible = ringV;
    for (const a of this.actives) { a.spill.visible = a.haze.visible = true; a.core.material = a.coreMat; }
    scene.background = bg; renderer.shadowMap.autoUpdate = true;
    glow.blurPass(glow.full, glow.a, 1, 0); glow.blurPass(glow.a, glow.b, 0, 1);
    glow.blurPass(glow.b, glow.a, 2, 0); glow.blurPass(glow.a, glow.b, 0, 2);
    glow.blurPass(glow.b, glow.a, 3, 0); glow.blurPass(glow.a, glow.b, 0, 3);
    glow.add.uniforms.tDiffuse.value = glow.b.texture; glow.quad.material = glow.add;
    renderer.setRenderTarget(null); renderer.autoClear = false; renderer.render(glow.qs, glow.qc); renderer.autoClear = true;
  }

  // ---------------------------------------------------------------- pointer
  private bindPointer() {
    const canvas = this.renderer.domElement, orbit = this.orbit;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); orbit.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, shift: e.shiftKey, moved: false }; });
    canvas.addEventListener("pointermove", (e) => {
      if (orbit.drag) {
        const dx = e.clientX - orbit.drag.x, dy = e.clientY - orbit.drag.y;
        orbit.drag.x = e.clientX; orbit.drag.y = e.clientY;
        if (Math.hypot(e.clientX - orbit.drag.sx, e.clientY - orbit.drag.sy) > 4) orbit.drag.moved = true;
        if (orbit.drag.btn === 2 || orbit.drag.btn === 1 || orbit.drag.shift) this.pan(dx, dy); else this.rotate(dx, dy);
        return;
      }
      this.cb.onHover(this.pickAt(e)?.s.id ?? null);
    });
    canvas.addEventListener("pointerup", (e) => {
      const d = orbit.drag; orbit.drag = null;
      if (!d || d.moved || d.btn !== 0) return;
      const cell = this.pickAt(e);
      if (cell) this.cb.onPick(cell.s.id, e.shiftKey);
      else if (!e.shiftKey) { const gid = this.pickPlate(e); if (gid) this.cb.onPickPlate(gid); }
    });
    canvas.addEventListener("pointerleave", () => this.cb.onHover(null));
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom(Math.exp(clamp(e.deltaY, -120, 120) * 0.0012)); }, { passive: false });
    canvas.addEventListener("dblclick", (e) => { const cell = this.pickAt(e); if (cell) this.cb.onOpen(cell.s.id); else this.viewOverview(); });
  }
  private rotate(dx: number, dy: number) { this.orbit.goal.theta -= dx * 0.006; this.orbit.goal.phi = clamp(this.orbit.goal.phi - dy * 0.006, 0.02, 1.52); }
  private pan(dx: number, dy: number) {
    const g = this.orbit.goal, s = g.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(g.theta), 0, -Math.sin(g.theta)), fwd = new THREE.Vector3(-Math.sin(g.theta), 0, -Math.cos(g.theta));
    g.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
  }
  private zoom(f: number) { this.orbit.goal.radius = clamp(this.orbit.goal.radius * f, 5, 220); }
  private setRay(e: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }
  private pickAt(e: MouseEvent): Cell | null {
    this.setRay(e);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    let best: Cell | null = null, bt = Infinity;
    for (const c of this.cells) { const t = rayHitColumn(o, d, c.pos.x, c.pos.z, HEX_R, c.h); if (t < bt) { bt = t; best = c; } }
    return best;
  }
  private pickPlate(e: MouseEvent): string | null {
    this.setRay(e);
    const hits = this.raycaster.intersectObjects(this.plates);
    return hits.length ? (hits[0].object.userData.gid as string) : null;
  }

  // ---------------------------------------------------------------- labels (HTML overlay)
  private buildGroupLabels() {
    for (const el of this.groupLabels.values()) el.remove();
    this.groupLabels.clear();
    for (const gid of this.input!.groupOrder) {
      const g = this.input!.groups[gid];
      if (!g || !this.input!.layout.centers.has(gid)) continue;
      const el = document.createElement("div"); el.className = "lbl group";
      this.labelsEl.appendChild(el); this.groupLabels.set(gid, el);
    }
    this.rebuildLabelsText();
  }
  private rebuildLabelsText() {
    for (const [gid, el] of this.groupLabels) {
      const g = this.input!.groups[gid], n = this.input!.layout.count.get(gid) ?? 0;
      el.innerHTML = `${escapeHtml(g.name)}<small>${n}${g.kind === "custom" ? " cells on loan" : " cells"}</small>`;
    }
  }
  private sessLabel(c: Cell) {
    let el = this.sessLabels.get(c.s.id);
    if (!el) { el = document.createElement("div"); el.className = "lbl sess"; el.textContent = c.s.title; this.labelsEl.appendChild(el); this.sessLabels.set(c.s.id, el); }
    el.dataset.used = "1";
    return el;
  }
  private placeLabel(el: HTMLElement, x: number, y: number, z: number) {
    this.tmpP.set(x, y, z).project(this.camera);
    const off = this.tmpP.z > 1 || Math.abs(this.tmpP.x) > 1.2 || Math.abs(this.tmpP.y) > 1.2;
    el.classList.toggle("hidden", off);
    if (off) return;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    el.style.transform = `translate(-50%,-100%) translate(${(((this.tmpP.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - this.tmpP.y) / 2) * h).toFixed(1)}px)`;
  }
  private overlapsPlaced(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    for (const b of this.placedBoxes) if (r.left < b.right + 4 && r.right > b.left - 4 && r.top < b.bottom + 2 && r.bottom > b.top - 2) return true;
    this.placedBoxes.push(r); return false;
  }
  private updateLabels() {
    if (!this.input) return;
    const near = this.orbit.cur.radius < 45;
    this.placedBoxes.length = 0;
    for (const el of this.sessLabels.values()) el.dataset.used = "";
    const isHot = (c: Cell) => c.s.id === this.hover || this.selected.has(c.s.id) || c.s.id === this.focusSession;
    const place = (c: Cell | undefined, allowDrop: boolean) => {
      if (!c || !c.slot) return;
      const el = this.sessLabel(c);
      el.classList.toggle("hot", isHot(c));
      this.placeLabel(el, c.pos.x, c.h + 0.7, c.pos.z);
      if (!el.classList.contains("hidden") && this.overlapsPlaced(el) && allowDrop) el.classList.add("hidden");
    };
    const primary = new Map<string, Cell>();
    for (const id of [this.hover, this.focusSession, ...this.selected]) { const c = id ? this.byId.get(id) : undefined; if (c) primary.set(c.s.id, c); }
    for (const c of primary.values()) place(c, false);
    for (const [gid, el] of this.groupLabels) {
      const center = this.input.layout.centers.get(gid);
      if (!center) { el.classList.add("hidden"); continue; }
      this.placeLabel(el, center.x, (this.input.layout.maxH.get(gid) ?? 0) + 1.8, center.z);
      if (!el.classList.contains("hidden") && this.overlapsPlaced(el)) el.classList.add("hidden");
    }
    const secondary: Cell[] = [];
    for (const a of this.actives) { const c = this.byId.get(a.s.id); if (c && !primary.has(c.s.id)) secondary.push(c); }
    if (near && this.focusGroup) for (const c of this.cells.filter((c) => c.group === this.focusGroup).sort((a, b) => b.h - a.h).slice(0, 6)) if (!primary.has(c.s.id)) secondary.push(c);
    for (const c of new Set(secondary)) place(c, true);
    for (const [sid, el] of this.sessLabels) if (!el.dataset.used) { el.remove(); this.sessLabels.delete(sid); }
  }

  // ---------------------------------------------------------------- loop
  private frame = (now: number) => {
    if (this.disposed) return;
    try { this.tick(now); } catch (err) { console.error(err); }
    this.raf = requestAnimationFrame(this.frame);
  };
  private tick(now: number) {
    const dt = clamp((now - this.last) / 1000, 0, 0.05); this.last = now;
    const o = this.orbit, k = 1 - Math.exp(-dt * 7);
    o.cur.target.lerp(o.goal.target, k);
    o.cur.theta = lerp(o.cur.theta, o.goal.theta, k); o.cur.phi = lerp(o.cur.phi, o.goal.phi, k); o.cur.radius = lerp(o.cur.radius, o.goal.radius, k);
    const r = o.cur.radius, p = o.cur.phi, t = o.cur.theta;
    this.camera.position.set(o.cur.target.x + r * Math.sin(p) * Math.sin(t), o.cur.target.y + r * Math.cos(p), o.cur.target.z + r * Math.sin(p) * Math.cos(t));
    this.camera.lookAt(o.cur.target);

    if (this.heightsAnimating) {
      const kk = 1 - Math.exp(-dt * 6);
      let moving = false;
      for (const c of this.cells) {
        if (Math.abs(c.h - c.hTarget) < 0.003) { if (c.h !== c.hTarget) { c.h = c.hTarget; this.setHexMatrix(c); } continue; }
        c.h = lerp(c.h, c.hTarget, kk); this.setHexMatrix(c); moving = true;
      }
      for (const m of [this.hexMesh, this.dimMesh]) if (m) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aHeight.needsUpdate = true; }
      this.heightsAnimating = moving;
    }
    const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * 3.0); // one shared, shallow breath for every running session
    for (const a of this.actives) {
      const c = this.byId.get(a.s.id); if (!c) continue;
      a.hCore.value = c.h;
      (a.core.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.35 + 0.3 * pulse;
      a.glowMat.color.copy(a.glowLo).lerp(a.glowHi, pulse);
      a.light.position.y = c.h + 1; a.light.intensity = 0.35 + 0.25 * pulse;
      const grow = 1.1 + 0.14 * pulse;
      a.haze.scale.set(grow, 1, grow); a.hHaze.value = c.h + 0.15 + 0.3 * pulse;
      (a.haze.material as THREE.MeshBasicMaterial).opacity = 0.26 - 0.16 * pulse;
      (a.spill.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.08 * pulse;
    }
    this.updateLabels();
    this.renderWithGlow();
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]!);
