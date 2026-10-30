// The railway-compartment card table on starhermit:scene, as the browser
// build's ui.js drew it with three.js r185: a round felt table in a wood skirt
// and bumper rail with a brass inlay, the moquette carpet far below, a brass
// pendant lamp with a glowing bulb, a hemisphere fill, the lamp's point glow
// and a directional key from the lamp side whose shadow box hugs the table;
// every hand around the table (only the local seat's face up, at the
// bottom), the last eight discards with a little jitter, the stock as a
// stack of backs whose height follows its count, a lift for legal cards
// (more for the hovered and selected one), a selection outline and a ground
// marker at the first legal card, spark bursts on plays, suit calls and the
// win, and the ambient motion of the carriage (the pendant sways, the lamp
// shimmers, platform lights sweep past, dust drifts in the light; all still
// under reduced motion or at Low). Graphics levels set the look (quality.ts):
// materials, texture sizes, geometry detail, shadows, reflections, post
// effects, sparks and dust. Lights, shadows and the environment are the old
// page's own values (three.js r155+ units at engine.minor 24).
//
// The table is drawn in the playfield rectangle the UI leaves (setView): the
// camera keeps that rectangle's aspect through setViewOffset, as the old
// canvas sat between the HUD and the hand tray; the UI paints the page
// around it.
import {
  ACESFilmicToneMapping, AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, ClampToEdgeWrapping, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, PCFShadowMap, PMREMGenerator, PerspectiveCamera, PlaneGeometry,
  PointLight, Points, PointsMaterial, Quaternion, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, Shape, ShapeGeometry,
  SphereGeometry, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene, type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { W, type Card, type GameEvent, type State, type Theme } from "./game.ts";
import type { Look } from "./quality.ts";

type G2 = OffscreenCanvasRenderingContext2D;
let q: Look | null = null;
let theme: Theme | null = null;
let reducedMotion = false;
let active = false;

const SUIT_COLORS = { standard: ["#c0392b", "#c0392b", "#2c3e50", "#2c3e50"], cvd: ["#d55e00", "#e69f00", "#0072b2", "#6a51a3"] };
let suitPalette: "standard" | "cvd" = "standard";
const SUIT_ORDER = ["hearts", "diamonds", "clubs", "spades"];

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- procedural card textures
let texCache = new Map<string, Texture>();
function roundRect(g: G2, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function drawSuitGlyph(g: G2, suitIdx: number, cx: number, cy: number, size: number, color: string): void {
  g.fillStyle = color;
  g.save();
  g.translate(cx, cy);
  const s = size / 100;
  g.scale(s, s);
  g.beginPath();
  if (suitIdx === 0) {
    g.moveTo(0, 30);
    g.bezierCurveTo(-55, -10, -35, -50, 0, -22);
    g.bezierCurveTo(35, -50, 55, -10, 0, 30);
  } else if (suitIdx === 1) {
    g.moveTo(0, -40); g.lineTo(30, 0); g.lineTo(0, 40); g.lineTo(-30, 0);
  } else if (suitIdx === 2) {
    g.arc(0, -20, 19, 0, Math.PI * 2);
    g.moveTo(19 + 18, 6);
    g.arc(19, 6, 18, 0, Math.PI * 2);
    g.moveTo(-19 + 18, 6);
    g.arc(-19, 6, 18, 0, Math.PI * 2);
    g.moveTo(0, 14);
    g.lineTo(10, 42); g.lineTo(-10, 42); g.closePath();
  } else {
    g.moveTo(0, -42);
    g.bezierCurveTo(-55, 0, -32, 38, -6, 20);
    g.lineTo(-12, 44); g.lineTo(12, 44); g.lineTo(6, 20);
    g.bezierCurveTo(32, 38, 55, 0, 0, -42);
  }
  g.fill();
  g.restore();
}
const detailed = (): boolean => !!q?.detailed;
function finishTexture(c: OffscreenCanvas): Texture {
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  if (detailed()) tex.anisotropy = 4;
  return tex;
}
function cardFaceTexture(card: Card): Texture {
  const k = detailed() ? q!.budget.cardTex : 1;
  const key = `${card.id}:${suitPalette}:${k}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = new OffscreenCanvas(Math.round(128 * k), Math.round(180 * k));
  const g = c.getContext("2d");
  g.scale(k, k);
  if (detailed()) {
    const grad = g.createLinearGradient(0, 0, 128, 180);
    grad.addColorStop(0, "#fffef8"); grad.addColorStop(1, "#f1ece0");
    g.fillStyle = grad;
  } else g.fillStyle = "#fdfdf8";
  g.fillRect(0, 0, 128, 180);
  g.strokeStyle = "#b9b2a4"; g.lineWidth = 1.5;
  roundRect(g, 4, 4, 120, 172, 8); g.stroke();
  const suitIdx = SUIT_ORDER.indexOf(card.suit);
  const color = SUIT_COLORS[suitPalette][suitIdx]!;
  const rank = W.rankName(card.rank);
  g.fillStyle = color;
  g.font = "bold 30px serif";
  g.textAlign = "left"; g.textBaseline = "top";
  g.fillText(rank, 9, 8);
  g.save();
  g.translate(119, 172); g.rotate(Math.PI);
  g.fillText(rank, 0, 0);
  g.restore();
  drawSuitGlyph(g, suitIdx, 64, 94, 70, color);
  drawSuitGlyph(g, suitIdx, 19, 50, 18, color);
  if (card.rank === 8) {
    g.strokeStyle = color; g.lineWidth = 3;
    g.setLineDash([6, 4]);
    roundRect(g, 9, 9, 110, 162, 7); g.stroke();
    g.setLineDash([]);
  }
  const tex = finishTexture(c);
  texCache.set(key, tex);
  return tex;
}
function cardBackTexture(): Texture {
  const k = detailed() ? q!.budget.cardTex : 1;
  const key = `back:${k}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = new OffscreenCanvas(Math.round(128 * k), Math.round(180 * k));
  const g = c.getContext("2d");
  g.scale(k, k);
  g.fillStyle = "#f4efe4";
  g.fillRect(0, 0, 128, 180);
  g.fillStyle = "#8a2f3c";
  roundRect(g, 6, 6, 116, 168, 7); g.fill();
  g.strokeStyle = "#e8c890"; g.lineWidth = 2.5;
  roundRect(g, 11, 11, 106, 158, 6); g.stroke();
  g.save();
  roundRect(g, 13, 13, 102, 154, 5); g.clip();
  g.strokeStyle = "rgba(232,200,144,0.45)"; g.lineWidth = 1;
  for (let i = -8; i < 12; i++) {
    g.beginPath(); g.moveTo(i * 16, 10); g.lineTo(i * 16 + 80, 170); g.stroke();
    g.beginPath(); g.moveTo(i * 16 + 80, 10); g.lineTo(i * 16, 170); g.stroke();
  }
  g.restore();
  g.fillStyle = "#6e2230";
  g.beginPath(); g.arc(64, 90, 22, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#e8c890"; g.lineWidth = 2;
  g.beginPath(); g.arc(64, 90, 22, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#e8c890";
  g.font = "bold 28px serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("8", 64, 92);
  const tex = finishTexture(c);
  texCache.set(key, tex);
  return tex;
}

// Greyscale procedural surfaces, tinted by the material colour so every theme reuses them.
const surfCache = new Map<string, Texture>();
function surfaceTexture(kind: "felt" | "wood" | "carpet"): Texture {
  const sc = q!.budget.surfTex, ck = `${kind}:${sc}`;
  const hit = surfCache.get(ck);
  if (hit) return hit;
  const rnd = prng(kind === "felt" ? 11 : kind === "wood" ? 23 : 37);
  const dims = kind === "felt" ? [256, 256] : kind === "wood" ? [512, 128] : [128, 128];
  const c = new OffscreenCanvas(Math.round(dims[0]! * sc), Math.round(dims[1]! * sc));
  const g = c.getContext("2d");
  g.scale(sc, sc);
  if (kind === "felt") {
    g.fillStyle = "#e6e6e6"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * 256, y = rnd() * 256, v = Math.floor(200 + rnd() * 55);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1 + rnd() * 2, 1);
    }
  } else if (kind === "wood") {
    g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * 128, v = Math.floor(150 + rnd() * 105);
      g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
      g.lineWidth = 0.6 + rnd() * 2.4;
      g.beginPath();
      for (let x = 0; x <= 512; x += 16) g.lineTo(x, y + Math.sin(x / 60 + i) * 3 + Math.sin(x / 17 + i * 3) * 0.8);
      g.stroke();
    }
  } else {
    g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#c8c8c8";
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) {
      g.beginPath(); g.moveTo(x + 16, y + 4); g.lineTo(x + 28, y + 16); g.lineTo(x + 16, y + 28); g.lineTo(x + 4, y + 16); g.fill();
    }
    g.fillStyle = "#7a7a7a";
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) g.fillRect(x + 14, y + 14, 4, 4);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  surfCache.set(ck, tex);
  return tex;
}
let sweepTex: Texture | null = null;
function sweepTexture(): Texture {
  if (sweepTex) return sweepTex;
  const c = new OffscreenCanvas(256, 4);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.5, "rgba(255,255,255,1)");
  grad.addColorStop(0.58, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 4);
  sweepTex = new CanvasTexture(c);
  sweepTex.wrapS = ClampToEdgeWrapping;
  return sweepTex;
}

// ---------------------------------------------------------------- materials
type Params = Record<string, unknown>;
const LAMBERT_KEYS = ["color", "map", "side", "transparent", "opacity", "emissive"];
function surface(params: Params, extras?: Params): Material {
  const kind = q!.budget.material;
  if (kind === "lambert") {
    const p: Params = {};
    for (const key of LAMBERT_KEYS) if (params[key] !== undefined) p[key] = params[key];
    return new MeshLambertMaterial(p as never);
  }
  if (kind === "physical" && extras) return new MeshPhysicalMaterial({ ...params, ...extras } as never);
  return new MeshStandardMaterial(params as never);
}
const seg = (n: number, min = 3): number => Math.max(min, Math.round(n * q!.budget.segments));

// ---------------------------------------------------------------- the scene
const cardW = 1.1, cardH = 1.55, cardT = 0.012;
let cardGeoPlain: BufferGeometry | null = null, cardGeoDetailed: BufferGeometry | null = null;
let matCache = new Map<string, Material>();
const camera = new PerspectiveCamera(42, 1, 0.1, 120);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = PCFShadowMap;

function roundedShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function planarCardUvs(geo: BufferGeometry): BufferGeometry {
  const pos = geo.getAttribute("position") as BufferAttribute, uv = geo.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / cardW + 0.5, v = pos.getY(i) / cardH + 0.5;
    uv.setXY(i, Math.min(0.995, Math.max(0.005, u)), Math.min(0.995, Math.max(0.005, v)));
  }
  uv.needsUpdate = true;
  return geo;
}
function buildCardGeometry(): void {
  const shape = roundedShape(cardW, cardH, 0.09);
  cardGeoPlain = planarCardUvs(new ShapeGeometry(shape, 4));
  const ext = new ExtrudeGeometry(shape, { depth: cardT, bevelEnabled: false, curveSegments: 5 });
  ext.clearGroups();
  cardGeoDetailed = planarCardUvs(ext);
}
const texIds = new WeakMap<Texture, number>();
let texSeq = 0;
function cardMaterial(tex: Texture): Material {
  let tid = texIds.get(tex);
  if (tid == null) { tid = ++texSeq; texIds.set(tex, tid); }
  const key = `${tid}:${detailed()}:${q!.budget.material}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = detailed()
    ? surface({ map: tex, color: 0xf2f2f2, roughness: 0.55, metalness: 0, envMapIntensity: 0.15 }, { clearcoat: 0.25, clearcoatRoughness: 0.35 })
    : new MeshLambertMaterial({ map: tex });
  matCache.set(key, m);
  return m;
}

const hemiLight = new HemisphereLight(0xfff2df, 0x2a1d18, 0.55);
hemiLight.position.set(0, 0, 1);
const LAMP_POWER = 22;
const lampLight = new PointLight(0xffd9a0, LAMP_POWER, 40, 1.8);
lampLight.position.set(0, 1.5, 7.2);
const keyLight = new DirectionalLight(0xffd9a0, 0.75);
keyLight.position.set(1.2, -1.5, 14);
keyLight.target.position.set(0, 0.4, 0);
{
  const sc = keyLight.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  sc.left = -8.2; sc.right = 8.2; sc.top = 8.2; sc.bottom = -8.2; sc.near = 8; sc.far = 22;
  sc.updateProjectionMatrix();
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 3;
}
scene.add(hemiLight, lampLight, keyLight, keyLight.target);
scene.fog = new Fog(0x000000, 20, 42);

let envGroup: Mesh[] = [];
let lampGroup: Mesh[] = [];
let bulbMat: MeshBasicMaterial | null = null;
let sweepMesh: Mesh | null = null;
let dust: Points | null = null, dustBase: Float32Array | null = null;
function disposeEnv(): void {
  for (const m of envGroup) { scene.remove(m); m.geometry.dispose(); (m.material as Material).dispose(); }
  envGroup = []; lampGroup = []; sweepMesh = null; bulbMat = null;
}
function addEnv(m: Mesh): Mesh { envGroup.push(m); scene.add(m); return m; }
function buildEnvironment(): void {
  const t = theme!, rich = detailed();
  const woodMat = () => rich
    ? surface({ color: t.wood, map: surfaceTexture("wood"), roughness: 0.42, envMapIntensity: 0.35 }, { clearcoat: 0.5, clearcoatRoughness: 0.25 })
    : new MeshLambertMaterial({ color: t.wood });
  const skirt = addEnv(new Mesh(new CylinderGeometry(7.6, 7.3, 0.9, seg(64, 24), 1, true), woodMat()));
  skirt.rotation.x = Math.PI / 2; skirt.position.z = -0.55; skirt.castShadow = true;
  const rail = addEnv(new Mesh(new TorusGeometry(7.45, 0.26, rich ? seg(12, 6) : 6, seg(72, 32)), woodMat()));
  rail.position.z = -0.12; rail.receiveShadow = true; rail.castShadow = true;
  const feltMat = rich
    ? surface({ color: t.felt, map: surfaceTexture("felt"), roughness: 0.95, metalness: 0, envMapIntensity: 0.25 })
    : new MeshLambertMaterial({ color: t.felt });
  if (rich) (feltMat as MeshStandardMaterial).map!.repeat.set(5, 5);
  const felt = addEnv(new Mesh(new CircleGeometry(7.25, seg(72, 32)), feltMat));
  felt.position.z = -0.06; felt.receiveShadow = true;
  const brass = addEnv(new Mesh(new RingGeometry(6.55, 6.63, seg(96, 40)),
    rich ? surface({ color: 0xc9a25a, metalness: 1, roughness: 0.42 }) : new MeshLambertMaterial({ color: 0xb8924e })));
  brass.position.z = -0.055;
  const floorColor = new Color(t.wall).multiplyScalar(rich ? 1.1 : 1.5);
  const floorMat = rich
    ? surface({ color: floorColor, map: surfaceTexture("carpet"), roughness: 1, envMapIntensity: 0.15 })
    : new MeshLambertMaterial({ color: floorColor });
  if (rich) (floorMat as MeshStandardMaterial).map!.repeat.set(24, 24);
  const floor = addEnv(new Mesh(new PlaneGeometry(140, 140), floorMat));
  floor.position.z = -3.2; floor.receiveShadow = true;
  // pendant lamp: brass shade and a glowing bulb
  const shade = addEnv(new Mesh(new CylinderGeometry(0.35, 0.95, 0.7, seg(32, 12), 1, true),
    rich ? surface({ color: 0xc9a25a, metalness: 1, roughness: 0.35, side: DoubleSide }) : new MeshLambertMaterial({ color: 0x8a6a3a, side: DoubleSide })));
  shade.rotation.x = Math.PI / 2;
  bulbMat = new MeshBasicMaterial({ color: new Color(t.lamp) });
  const bulb = addEnv(new Mesh(new SphereGeometry(0.42, seg(20, 10), seg(14, 7)), bulbMat));
  lampGroup = [shade, bulb];
  // passing platform lights sweeping the felt
  sweepMesh = addEnv(new Mesh(new CircleGeometry(7.1, 48),
    new MeshBasicMaterial({ map: sweepTexture(), color: 0xbcd0ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, depthTest: false })));
  sweepMesh.position.z = 0.2;
  sweepMesh.renderOrder = 5;
  sweepMesh.visible = false;
  applyBulb();
}
/** The bulb glows past 1 with bloom on, so only the lamp (and sparks) bloom. */
function applyBulb(): void {
  if (!bulbMat || !theme) return;
  bulbMat.color.set(theme.lamp).multiplyScalar(q?.bloom ? 3 : 1);
}
function buildDust(): void {
  if (dust) { scene.remove(dust); dust.geometry.dispose(); dust = null; }
  if (!q || q.particles !== "high" || !theme) return;
  const rnd = prng(5);
  const n = q.budget.dust, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rnd()) * 4, a = rnd() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r * 0.8 - 1; pos[i * 3 + 2] = 0.6 + rnd() * 5;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  dust = new Points(geo, new PointsMaterial({ color: new Color(theme.lamp), size: 0.035, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending }));
  dustBase = pos.slice();
  scene.add(dust);
}

// selection outline and legal marker (lift + rim + grounded marker, never glow alone)
let outlineMesh: Mesh | null = null, markerMesh: Mesh | null = null;
// sparks: one additive instanced mesh at Particles "high"; plain bursts at low
const SPARK_POOL = 512;
const particleGeo = new PlaneGeometry(1, 1);
const sparkMesh = new InstancedMesh(particleGeo, new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }), SPARK_POOL);
sparkMesh.setColorAt(0, new Color(0));
sparkMesh.count = 0;
sparkMesh.frustumCulled = false;
scene.add(sparkMesh);
interface Spark { pos: Vector3; vel: Vector3; color: Color; s: number; rot: number; spin: number; life: number; max: number }
const sparks: Spark[] = [];
const LOW_POOL = 48;
const lowMeshes: Mesh[] = [];
const lowState: (Spark | null)[] = [];
for (let i = 0; i < LOW_POOL; i++) {
  const m = new Mesh(particleGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: NormalBlending, side: DoubleSide }));
  m.visible = false;
  scene.add(m);
  lowMeshes.push(m);
  lowState.push(null);
}
const _m4 = new Matrix4(), _q = new Quaternion(), _v = new Vector3(), _c = new Color(), _z = new Vector3(0, 0, 1);

function burst(pos: Vector3, color: number, strong: boolean): void {
  if (reducedMotion || !q) return;
  const high = q.particles === "high";
  const c = new Color(color);
  if (high) {
    if (q.bloom) c.multiplyScalar(2.2);
    const n = Math.round((strong ? 36 : 22) * q.budget.sparks);
    for (let j = 0; j < n && sparks.length < SPARK_POOL; j++) {
      sparks.push({
        pos: pos.clone(), color: c.clone(), s: 0.05 + Math.random() * 0.07, rot: Math.random() * Math.PI,
        vel: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5), spin: (Math.random() - 0.5) * 8, life: 0.9, max: 0.9,
      });
    }
    return;
  }
  for (let i = 0, slot = 0; i < 8 && slot < LOW_POOL; slot++) {
    if (lowState[slot]) continue;
    lowState[slot] = {
      pos: pos.clone(), color: c.clone(), s: 0.09, rot: Math.random() * Math.PI,
      vel: new Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5), spin: (Math.random() - 0.5) * 8, life: 0.7, max: 0.7,
    };
    (lowMeshes[slot]!.material as MeshBasicMaterial).color.copy(c);
    i++;
  }
}

// ---------------------------------------------------------------- environment and post effects
let pmrem: PMREMGenerator | null = null;
let envTexture: Texture | null = null;
function applyReflections(): void {
  if (!q?.reflections) { scene.environment = null; return; }
  if (!envTexture) {
    pmrem = pmrem ?? new PMREMGenerator(renderer);
    // three.js r185 (the old page): the 900-candela room, lowered as r183+ does
    const room = new RoomEnvironment(renderer);
    (room as unknown as { position: Vector3 }).position.y = -3.5;
    envTexture = pmrem.fromScene(room, 0.04).texture;
  }
  scene.environment = envTexture;
}
scene.environmentIntensity = 0.3;
function applyPost(): void {
  if (!q) return;
  renderer.antialias = q.antialias;
  renderer.bloom = q.bloom ? { strength: 0.45, radius: 0.4, threshold: 1.35, resolution: q.budget.bloomRes } : null;
  renderer.ao = q.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1, samples: q.ao === "high" ? 16 : 8, resolution: q.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === "high" ? 6 : 4, rings: 2, samples: q.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // the old grade pass ran on the linear frame before the output's tone mapping
  renderer.grade = q.grade ? {
    space: "linear", overRange: "keep", // minor 29: mix(c, s + max(c - 1, 0), amount) as the page's GradeShader
    contrast: 0.22, saturation: 1.1, shadows: [0.95, 0.98, 1.05], highlights: [1.05, 1, 0.94], split: [0.15, 0.8],
    vignette: { amount: 0.28, inner: 0.3, outer: 0.8, scale: [1, 0.9] },
  } : null;
}

// ---------------------------------------------------------------- public: look, theme, palette
let built = false;
export function applyLook(look: Look): void {
  const prevDetail = q?.detailed, prevBudget = JSON.stringify(q?.budget ?? null), prevParticles = q?.particles;
  q = look;
  renderer.shadowMap.enabled = look.shadows > 0;
  keyLight.castShadow = look.shadows > 0;
  if (look.shadows > 0) keyLight.shadow.mapSize = look.shadows;
  applyReflections();
  applyPost();
  const budgetChanged = prevBudget !== JSON.stringify(look.budget);
  if (!built) {
    buildCardGeometry();
    outlineMesh = new Mesh(new ShapeGeometry(roundedShape(cardW + 0.16, cardH + 0.16, 0.14), 4),
      new MeshBasicMaterial({ color: new Color(0xffe9b0).multiplyScalar(1.15), transparent: true, opacity: 0.95 }));
    outlineMesh.visible = false;
    scene.add(outlineMesh);
    markerMesh = new Mesh(new RingGeometry(0.16, 0.26, 32), new MeshBasicMaterial({ color: 0x9fe6a0, transparent: true, opacity: 0.9 }));
    markerMesh.visible = false;
    scene.add(markerMesh);
    built = true;
  }
  if (theme && (prevDetail !== look.detailed || budgetChanged || !envGroup.length)) {
    clearCardCaches();
    disposeEnv();
    buildEnvironment();
  }
  applyBulb();
  if (prevParticles !== look.particles || budgetChanged) buildDust();
  dirty = true;
}
export function setTheme(t: Theme): void {
  if (theme && t.id === theme.id && envGroup.length) return;
  theme = t;
  const bg = new Color(t.wall).multiplyScalar(0.6);
  scene.background = bg;
  scene.fog!.color.copy(bg);
  lampLight.color.set(t.lamp);
  keyLight.color.set(t.lamp);
  if (!q) return;
  disposeEnv();
  buildEnvironment();
  buildDust();
}
export function setSuitPalette(p: "standard" | "cvd"): void {
  if (p === suitPalette) return;
  suitPalette = p;
  clearCardCaches();
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
function clearCardCaches(): void {
  for (const m of matCache.values()) m.dispose();
  matCache = new Map();
  for (const t of texCache.values()) t.dispose();
  texCache = new Map();
  dirty = true;
}

// ---------------------------------------------------------------- the cards
interface View { state: State; legal: number[]; onTurn: boolean; selected: number | null; mySeat: number }
let view: View | null = null;
let dirty = true;
let hovered: number | null = null;
const pool: Mesh[] = [];
const handMeshes: { mesh: Mesh; cardId: number }[] = []; // the local seat's cards (picking)
let used = 0;
function meshFor(tex: Texture): Mesh {
  let m = pool[used];
  const geo = detailed() ? cardGeoDetailed! : cardGeoPlain!;
  if (!m) { m = new Mesh(geo, cardMaterial(tex)); m.castShadow = true; m.receiveShadow = true; scene.add(m); pool.push(m); }
  else { if (m.geometry !== geo) m.geometry = geo; const mat = cardMaterial(tex); if (m.material !== mat) m.material = mat; m.visible = true; }
  used++;
  return m;
}
function seatTransform(seat: number, players: number): { angle: number; x: number; y: number } {
  const angles = players === 2 ? [-Math.PI / 2, Math.PI / 2] : players === 3 ? [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6] : [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const a = angles[seat]!;
  return { angle: a, x: Math.cos(a) * 5.4, y: Math.sin(a) * 5.4 };
}
/** The state to draw (ui.js renderState): only the local seat face up, at the bottom. */
export function renderState(state: State, legal: number[], onTurn: boolean, selected: number | null, mySeat: number): void {
  view = { state, legal: onTurn ? legal : [], onTurn, selected, mySeat };
  dirty = true;
}
export function clearTable(): void { view = null; dirty = true; }
function layout(): void {
  used = 0;
  handMeshes.length = 0;
  if (!view || !cardGeoPlain) { for (const m of pool) m.visible = false; if (outlineMesh) outlineMesh.visible = false; if (markerMesh) markerMesh.visible = false; return; }
  const { state, legal, onTurn, selected, mySeat } = view;
  const players = state.players;
  let marker = false;
  let sel: Mesh | null = null;
  const focus = hovered != null ? hovered : selected;
  for (let seat = 0; seat < players; seat++) {
    const visualSeat = (seat - mySeat + players) % players;
    const st = seatTransform(visualSeat, players);
    const hand = state.hands[seat] ?? [];
    const n = hand.length;
    const isMe = seat === mySeat;
    for (let i = 0; i < n; i++) {
      const card = hand[i]!;
      const mesh = meshFor(isMe && card.id >= 0 ? cardFaceTexture(card) : cardBackTexture());
      const spread = Math.min(0.62, 5.6 / Math.max(1, n));
      const u = (i - (n - 1) / 2) * spread;
      const px = st.x + -Math.sin(st.angle) * u;
      const py = st.y + Math.cos(st.angle) * u;
      const pz = 0.06 + i * 0.016;
      const rot = isMe ? -u * 0.06 : -st.angle - Math.PI / 2;
      const isLegal = isMe && legal.includes(card.id);
      let lift = isLegal ? 0.28 : 0;
      if (isMe && isLegal && card.id === hovered) lift = 0.5;
      if (isMe && card.id === selected) lift = 0.65;
      let z = pz + lift;
      if (isMe && isLegal && !reducedMotion) z += 0.02 * Math.sin(i);
      mesh.position.set(px, py + (isMe ? lift * 0.6 : 0), z);
      mesh.rotation.set(0, 0, rot);
      if (isMe) {
        handMeshes.push({ mesh, cardId: card.id });
        if (card.id === focus) sel = mesh;
      }
      if (isLegal && card.id === legal[0] && markerMesh) { markerMesh.position.set(px, py - 1.1, 0.02); marker = true; }
    }
  }
  if (markerMesh) markerMesh.visible = marker;
  const show = state.discardPile.slice(-8);
  for (let d = 0; d < show.length; d++) {
    const dc = show[d]!;
    const dm = meshFor(cardFaceTexture(dc));
    dm.position.set(0.9 + (((dc.id * 13) % 7) - 3) * 0.02, 0.3 + (((dc.id * 29) % 7) - 3) * 0.02, 0.05 + d * 0.016);
    dm.rotation.set(0, 0, (((dc.id * 37) % 23) - 11) * 0.02);
  }
  const stockN = state.stock.length;
  if (stockN > 0) {
    const layers = detailed() ? Math.min(6, Math.ceil(stockN / 5)) : 1;
    for (let s = 0; s < layers; s++) {
      const sm = meshFor(cardBackTexture());
      const top = s === layers - 1;
      const h = Math.min(10, stockN) * 0.006;
      sm.position.set(-1.6 + s * 0.006, 0.3 - s * 0.004, top ? 0.05 + h : 0.05 + s * (h / layers));
      sm.rotation.set(0, 0, 0.08 - s * 0.01);
    }
  }
  for (let i = used; i < pool.length; i++) pool[i]!.visible = false;
  if (outlineMesh) {
    if (sel && onTurn) {
      outlineMesh.position.copy(sel.position);
      outlineMesh.position.z -= 0.004;
      outlineMesh.rotation.z = sel.rotation.z;
      outlineMesh.visible = true;
    } else outlineMesh.visible = false;
  }
}
/** Cosmetic event feedback (ui.js playEvents). */
export function playEvents(events: GameEvent[]): void {
  for (const ev of events) {
    if (ev.type === "play" || ev.type === "win") burst(new Vector3(0.9, 0.3, 0.5), ev.type === "win" ? 0xffe9b0 : 0xffffff, ev.type === "win");
    if (ev.type === "suit") burst(new Vector3(0.9, 0.3, 0.6), 0xffd0f0, true);
  }
}

// ---------------------------------------------------------------- the view and picking
const FIT_RADIUS = 7.6;
const CAM_TARGET = new Vector3(0, 0.4, 0);
const CAM_DIR = new Vector3(0, -13.6, 12.6).normalize();
let rect = { x: 0, y: 0, w: 1, h: 1 };
let winW = 1, winH = 1;
function frameCamera(): void {
  const vHalf = Math.tan((camera.fov * Math.PI) / 360);
  const hHalf = vHalf * camera.aspect;
  const dist = Math.max(FIT_RADIUS / vHalf, FIT_RADIUS / hHalf);
  camera.position.copy(CAM_TARGET).addScaledVector(CAM_DIR, dist);
  camera.lookAt(CAM_TARGET);
}
/** The playfield rectangle in window pixels (null: no table, a menu screen). */
export function setView(r: { x: number; y: number; w: number; h: number } | null, w: number, h: number): void {
  active = !!r;
  renderer.camera = active ? camera : null;
  if (!r) return;
  winW = w; winH = h;
  if (r.x === rect.x && r.y === rect.y && r.w === rect.w && r.h === rect.h && camera.view?.fullWidth === r.w) return;
  rect = { ...r };
  camera.aspect = Math.max(0.1, r.w / Math.max(1, r.h));
  camera.setViewOffset(r.w, r.h, -r.x, -r.y, w, h);
  frameCamera();
  camera.updateProjectionMatrix();
}
/** C: reframe the table (the browser build's camera/framing reset). */
export function reframe(): void { frameCamera(); camera.updateProjectionMatrix(); }
const raycaster = new Raycaster();
const ndc = new Vector2();
/** The local seat's card under a window point, or null. */
export function pickCard(x: number, y: number): number | null {
  if (!active || !view || !view.onTurn) return null;
  if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(handMeshes.map((h) => h.mesh), false);
  if (!hits.length) return null;
  const hit = handMeshes.find((h) => h.mesh === hits[0]!.object);
  return hit ? hit.cardId : null;
}
export function setHover(id: number | null): void { if (id !== hovered) { hovered = id; dirty = true; } }
export function isLegal(id: number): boolean { return !!view && view.legal.includes(id); }

// ---------------------------------------------------------------- the frame
const LAMP_BASE = new Vector3(0, 1.5, 7.5);
let clock = 0;
function ambient(dt: number): void {
  const moving = !reducedMotion && !!q?.animated;
  if (moving) clock += dt;
  const sway = moving ? Math.sin(clock * 0.9) * 0.12 + Math.sin(clock * 2.3) * 0.03 : 0;
  const [shade, bulb] = lampGroup;
  if (shade && bulb) {
    bulb.position.set(LAMP_BASE.x + sway, LAMP_BASE.y, LAMP_BASE.z);
    shade.position.set(LAMP_BASE.x + sway, LAMP_BASE.y, LAMP_BASE.z + 0.35);
    shade.rotation.set(Math.PI / 2, sway * 0.12, 0);
  }
  lampLight.position.set(sway, 1.5, 7.2);
  keyLight.position.set(1.2 + sway * 2, -1.5, 14);
  const shimmer = moving ? 1 + Math.sin(clock * 7.1) * 0.015 + Math.sin(clock * 12.7) * 0.01 : 1;
  lampLight.intensity = LAMP_POWER * shimmer;
  if (sweepMesh) {
    const period = 11, cyc = clock % period, pass = cyc / 2.6;
    sweepMesh.visible = moving && pass < 1;
    if (sweepMesh.visible) {
      const m = sweepMesh.material as MeshBasicMaterial;
      m.map!.offset.x = 0.9 - pass * 1.8;
      m.opacity = 0.09 * Math.sin(pass * Math.PI);
    }
  }
  if (dust && dustBase) {
    dust.visible = moving;
    if (moving) {
      const p = dust.geometry.getAttribute("position") as BufferAttribute, b = dustBase;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, b[i * 3]! + Math.sin(clock * 0.3 + i) * 0.25, b[i * 3 + 1]! + Math.cos(clock * 0.23 + i * 1.7) * 0.25, b[i * 3 + 2]! + Math.sin(clock * 0.17 + i * 0.5) * 0.3);
      }
      p.needsUpdate = true;
    }
  }
}
export function frame(dtIn: number): void {
  if (!active) return;
  const dt = Math.min(dtIn, 0.1);
  if (dirty) { layout(); dirty = false; }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const k = sparks[i]!;
    k.life -= dt;
    if (k.life <= 0) { sparks[i] = sparks[sparks.length - 1]!; sparks.pop(); continue; }
    k.pos.addScaledVector(k.vel, dt);
    k.vel.z -= 6 * dt;
    k.rot += k.spin * dt;
  }
  for (let si = 0; si < sparks.length; si++) {
    const k = sparks[si]!;
    _m4.compose(k.pos, _q.setFromAxisAngle(_z, k.rot), _v.set(k.s, k.s, k.s));
    sparkMesh.setMatrixAt(si, _m4);
    sparkMesh.setColorAt(si, _c.copy(k.color).multiplyScalar(Math.max(0, k.life / k.max)));
  }
  sparkMesh.count = sparks.length;
  sparkMesh.visible = sparks.length > 0;
  if (sparks.length) { sparkMesh.instanceMatrix.needsUpdate = true; if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true; }
  for (let i = 0; i < LOW_POOL; i++) {
    const k = lowState[i], m = lowMeshes[i]!;
    if (!k) { m.visible = false; continue; }
    k.life -= dt;
    if (k.life <= 0) { lowState[i] = null; m.visible = false; continue; }
    k.pos.addScaledVector(k.vel, dt);
    k.vel.z -= 6 * dt;
    k.rot += k.spin * dt;
    m.visible = true;
    m.position.copy(k.pos);
    m.rotation.set(0, 0, k.rot);
    m.scale.set(k.s, k.s, k.s);
    (m.material as MeshBasicMaterial).opacity = Math.max(0, k.life / k.max);
  }
  ambient(dt);
  void winW; void winH;
}
