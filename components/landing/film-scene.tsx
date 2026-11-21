"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, RoundedBox } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { AT, STEP as S, film, span, window4 } from "./film-state";

/**
 * The landing film: a quiet, misty world of glass miniatures joined by one thread of light.
 * Care (a pebble that beats) → the doctor's reasoning (a sheet) and its tests (tiles) → codes →
 * submitted into the fog → declined → thousands more → SEAL: the thread rewinds, the right
 * question appears at the order, the sheet is complete → accepted. Driven by scroll (film.p).
 */

// ── The thread's path (x is the story's direction) ───────────────────────────
const PATH = [
  [-34, 1.4, 0.4], [-18, 1.45, 0.2], [-6, 1.4, 0], [-2.2, 1.4, 0], [-1.3, 1.45, 0], [-0.85, 2.5, 0], [-0.45, 0.55, 0], [0.05, 3.3, 0], [0.5, 0.95, 0], [0.95, 1.5, 0], [1.6, 1.4, 0],
  [10, 1.3, 0.8], [22, 0.75, 1.7], [30, 0.4, 2], [38, 0.4, 2], [48, 0.9, 1.1], [62, 1.6, 0.3], [80, 2.6, -0.5], [100, 4.2, -2.2], [120, 5.8, -4.4], [139, 6.6, -5.6],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const CURVE = new THREE.CatmullRomCurve3(PATH, false, "centripetal", 0.5);
const LUT_N = 3000;
const LUT = Array.from({ length: LUT_N + 1 }, (_, i) => CURVE.getPointAt(i / LUT_N).x);
function uAtX(x: number) {
  if (x <= LUT[0]) return 0;
  if (x >= LUT[LUT_N]) return 1;
  let lo = 0;
  let hi = LUT_N;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (LUT[m] < x) lo = m;
    else hi = m;
  }
  return (lo + (x - LUT[lo]) / Math.max(1e-6, LUT[hi] - LUT[lo])) / LUT_N;
}

// Stations
const PEBBLE = new THREE.Vector3(0, 1.75, -2.4);
const SHEET = new THREE.Vector3(34, 3.7, -1.8);
const TILE_Y = 1.05;
const TILE_XS = [30.2, 32.1, 34, 35.9, 37.8];
const PANE = new THREE.Vector3(38.6, 3.6, -0.6);
const HOME_X = 38;
const INSURER = new THREE.Vector3(140, 7, -8);
const CROWD = new THREE.Vector3(97, 3.4, -4);

// ── Keyframes over scroll ─────────────────────────────────────────────────────
type Key = { p: number; head: number; pos: [number, number, number]; look: [number, number, number]; bg: string; fog: number; mx?: number };
const KEYS: Key[] = [
  { p: 0, head: -16, pos: [-3.5, 2.6, 12.5], look: [-0.5, 1.9, -0.8], bg: "#dde6e3", fog: 0.05 },
  { p: AT.care + S * 0.6, head: 3, pos: [0.5, 2.5, 10], look: [-1.2, 1.9, -1], bg: "#e1e9e5", fog: 0.04 },
  { p: AT.reasoning, head: 26, pos: [29.5, 3.2, 13], look: [30.8, 2.4, -1], bg: "#e4ebe6", fog: 0.035, mx: 34 },
  { p: AT.codes, head: 36, pos: [37, 3.3, 17.5], look: [37.6, 2.3, -1], bg: "#e1e9e6", fog: 0.035, mx: 34 },
  { p: AT.submitted, head: 110, pos: [64, 5.5, 18], look: [100, 4, -3], bg: "#d7e2e4", fog: 0.03 },
  { p: AT.declined, head: 139.5, pos: [91, 4.2, 12.5], look: [100, 3, -2], bg: "#bcc5ca", fog: 0.05 },
  { p: AT.region, head: 139.5, pos: [88, 5.5, 15], look: [97, 3.6, -4], bg: "#b8c1c6", fog: 0.02 },
  { p: AT.seal, head: 139.5, pos: [34, 8.2, 19], look: [34, 6.8, -1], bg: "#e3ebe5", fog: 0.03 },
  { p: AT.question, head: 139.5, pos: [32, 3.4, 12], look: [33.2, 2.6, -1], bg: "#e6ece4", fog: 0.033, mx: 35.5 },
  { p: AT.accepted, head: 139.5, pos: [64, 9, 27], look: [96, 3, -3], bg: "#e2eee8", fog: 0.024 },
  { p: AT.numbers, head: 139.5, pos: [58, 34, 52], look: [58, 0, -2], bg: "#e8efeb", fog: 0.012 },
  { p: AT.partners, head: 139.5, pos: [22, 16, 44], look: [44, 3, -2], bg: "#ecefea", fog: 0.02 },
  { p: AT.ending, head: 139.5, pos: [-2, 3.8, 12.5], look: [0, 3.4, -1.2], bg: "#efede5", fog: 0.04 },
  { p: 1, head: 139.5, pos: [-0.5, 3.4, 10.5], look: [0, 3.2, -1.5], bg: "#f1eee6", fog: 0.045 },
];
const POS = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.pos)), false, "centripetal");
const LOOK = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3(...k.look)), false, "centripetal");
const SHIFT_M = new THREE.CatmullRomCurve3(KEYS.map((k) => new THREE.Vector3((k.mx ?? k.look[0]) - k.look[0], 0, 0)), false, "catmullrom");
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _bg = new THREE.Color();
function keyAt(p: number) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = span(p, a.p, b.p);
  _bg.set(a.bg).lerp(_c2.set(b.bg), t);
  return { t: (i + t) / (KEYS.length - 1), head: a.head + (b.head - a.head) * t, bg: _bg, fog: a.fog + (b.fog - a.fog) * t };
}

// Phases used by several objects
const declined = (p: number) => window4(p, AT.declined - S * 0.3, AT.declined + S * 0.2, AT.seal - S * 0.35, AT.seal - S * 0.05);
const sealOn = (p: number) => span(p, AT.seal - S * 0.3, AT.seal + S * 0.3);
const answered = (p: number) => span(p, AT.question - S * 0.25, AT.question + S * 0.35);

/** Where the claim card is on the thread (x), how visible, and its state. */
function cardAt(p: number): { x: number; show: number; state: "out" | "declined" | "accepted" } {
  if (p < AT.submitted) return { x: HOME_X, show: span(p, AT.codes + S * 0.45, AT.codes + S * 0.85), state: "out" };
  if (p < AT.declined) return { x: HOME_X + span(p, AT.submitted, AT.submitted + S * 0.8) * (139 - HOME_X), show: 1, state: "out" };
  if (p < AT.seal) return { x: 139 - span(p, AT.declined - S * 0.1, AT.declined + S * 0.6) * 45, show: 1 - span(p, AT.region + S * 0.6, AT.region + S * 0.95), state: "declined" };
  if (p < AT.accepted) return { x: HOME_X, show: span(p, AT.question + S * 0.5, AT.question + S * 0.9), state: "accepted" };
  const out = span(p, AT.accepted - S * 0.1, AT.accepted + S * 0.4);
  const back = span(p, AT.accepted + S * 0.45, AT.accepted + S * 0.95);
  return { x: HOME_X + (out - back) * (139 - HOME_X), show: 1 - span(p, AT.numbers + S * 0.1, AT.numbers + S * 0.4), state: "accepted" };
}

/** Two quick beats every 1.25 s: a heart at rest. */
function heartbeat(t: number) {
  const k = t % 1.25;
  const beat = (c: number, w: number) => Math.exp(-((k - c) ** 2) / w);
  return beat(0.08, 0.0015) + 0.6 * beat(0.3, 0.002);
}

let GLOW: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (GLOW) return GLOW;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.18, "rgba(255,255,255,0.55)");
  r.addColorStop(0.5, "rgba(255,255,255,0.12)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(c);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

function Glass({ lite, tint = "#f3faf7", attenuation = "#bfe3d6", roughness = 0.28, matRef }: { lite: boolean; tint?: string; attenuation?: string; roughness?: number; matRef?: React.Ref<THREE.MeshPhysicalMaterial> }) {
  return lite ? (
    <meshPhysicalMaterial ref={matRef} color={tint} roughness={roughness} metalness={0} transparent opacity={0.62} clearcoat={1} clearcoatRoughness={0.2} envMapIntensity={1.2} />
  ) : (
    <meshPhysicalMaterial ref={matRef} color={tint} roughness={roughness} metalness={0} transmission={1} thickness={1.1} ior={1.42} clearcoat={1} clearcoatRoughness={0.15} attenuationColor={attenuation} attenuationDistance={2.2} envMapIntensity={1.3} />
  );
}

// ── The thread, and the light that runs back along it when SEAL arrives ──────
const SEG = 1400;
const RAD = 10;
function Thread() {
  const geos = useMemo(
    () =>
      [0, 1, 2].map((k) => {
        const pts = Array.from({ length: 700 }, (_, i) => {
          const u = i / 699;
          const p = CURVE.getPointAt(u);
          const a = u * 90 + (k * Math.PI * 2) / 3;
          return k === 0 ? p : p.add(new THREE.Vector3(0, Math.sin(a) * 0.055, Math.cos(a) * 0.055));
        });
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), SEG, k === 0 ? 0.022 : 0.011, RAD, false);
      }),
    [],
  );
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const head = useRef<THREE.Sprite>(null);
  const headMat = useRef<THREE.SpriteMaterial>(null);
  const rewind = useRef<THREE.Sprite>(null);
  const rewindMat = useRef<THREE.SpriteMaterial>(null);
  const c = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const p = film.p;
    const k = keyAt(p);
    const u = uAtX(k.head);
    for (const g of geos) g.setDrawRange(0, Math.floor(u * SEG) * RAD * 6);
    const grey = declined(p);
    const seal = sealOn(p);
    c.set("#ffffff").lerp(_c1.set("#8d9aa3"), grey).lerp(_c2.set("#7fe6b0"), seal * 0.55);
    const bright = 2.2 - grey * 1.3 + seal * 0.5;
    mats.current.forEach((m, i) => m?.color.copy(c).multiplyScalar(i === 0 ? bright : bright * 0.7));
    if (head.current && headMat.current) {
      head.current.position.copy(CURVE.getPointAt(Math.max(0.0005, u)));
      const beat = heartbeat(clock.elapsedTime) * (1 - span(p, AT.care + S * 0.6, AT.reasoning));
      head.current.scale.setScalar(0.75 + beat * 0.7 + seal * 0.25);
      headMat.current.color.copy(c).multiplyScalar(1.2 + beat * 0.8);
      headMat.current.opacity = 1 - grey * 0.6;
    }
    // VII: a green light travels back from the insurer to the moment of the order
    const r = span(p, AT.seal - S * 0.45, AT.seal + S * 0.05);
    const vis = window4(p, AT.seal - S * 0.45, AT.seal - S * 0.38, AT.seal, AT.seal + S * 0.12);
    if (rewind.current && rewindMat.current) {
      rewind.current.position.copy(CURVE.getPointAt(uAtX(139 - r * (139 - HOME_X))));
      rewind.current.scale.setScalar(1.4);
      rewindMat.current.opacity = vis;
    }
  });

  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial ref={(m) => void (mats.current[i] = m)} toneMapped={false} transparent opacity={i === 0 ? 0.95 : 0.6} depthWrite={false} />
        </mesh>
      ))}
      <sprite ref={head}>
        <spriteMaterial ref={headMat} map={glowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={rewind}>
        <spriteMaterial ref={rewindMat} map={glowTexture()} color={new THREE.Color("#7fe6b0").multiplyScalar(2)} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}

/** Many quiet threads behind the numbers: every claim, every day. */
function ThreadField() {
  const geo = useMemo(() => new THREE.TubeGeometry(CURVE, 500, 0.02, 6, false), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffffff").multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0, depthWrite: false }), []);
  const rows = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ z: -60 + i * 3.4 + (i % 3) * 0.7, y: Math.sin(i * 1.7) * 0.5, s: 0.9 + ((i * 37) % 10) / 50 })).filter((r) => Math.abs(r.z) > 2), []);
  useFrame(() => {
    mat.opacity = window4(film.p, AT.accepted + S * 0.7, AT.numbers + S * 0.2, AT.partners + S * 0.6, AT.ending - S * 0.1) * 0.5;
  });
  return (
    <group>
      {rows.map((r, i) => (
        <mesh key={i} geometry={geo} material={mat} position={[0, r.y, r.z]} scale={[1, r.s, 1]} />
      ))}
    </group>
  );
}

// ── I. Care: a glass pebble with a warm light that beats ─────────────────────
function Pebble({ lite }: { lite: boolean }) {
  const core = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const glow = useRef<THREE.SpriteMaterial>(null);
  const coreColor = useMemo(() => new THREE.Color("#ffd9a0").multiplyScalar(2.2), []);
  useFrame(({ clock }) => {
    const b = heartbeat(clock.elapsedTime);
    const end = span(film.p, AT.ending - S * 0.3, AT.ending + S * 0.4);
    if (core.current) core.current.scale.setScalar(0.32 + b * 0.04);
    if (light.current) light.current.intensity = 3 + b * 5 + end * 4;
    if (glow.current) glow.current.opacity = 0.55 * (0.7 + b * 0.8 + end * 0.6);
  });
  return (
    <group position={PEBBLE}>
      <mesh scale={[1.45, 1.1, 1.3]} rotation={[0.1, 0.4, 0]}>
        <sphereGeometry args={[1, 64, 48]} />
        <Glass lite={lite} tint="#fbf7f0" attenuation="#f0d7b4" roughness={0.35} />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial color={coreColor} toneMapped={false} />
      </mesh>
      <sprite scale={[3.2, 3.2, 1]}>
        <spriteMaterial ref={glow} map={glowTexture()} color="#ffcf8a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight ref={light} color="#ffc98a" distance={7} decay={2} />
    </group>
  );
}

// ── II–VIII. The sheet: the doctor's reasoning ───────────────────────────────
const NOTE_LINES = [0.92, 0.78, 0.86, 0.62, 0.9, 0.7, 0.56, 0.84];
const GAPS = [3, 6];
const W = 2.9;
function Sheet({ lite }: { lite: boolean }) {
  // one material per faded line, shared by its segments
  const solidMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#5d6f6c", transparent: true }), []);
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#8ea19c", transparent: true, opacity: 0 }), []);
  const fills = useRef<(THREE.Mesh | null)[]>([]);
  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffd79a", toneMapped: false }), []);
  const rise = useRef<THREE.Sprite>(null);
  const riseMat = useRef<THREE.SpriteMaterial>(null);
  const green = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const p = film.p;
    // III: the reasoning stays behind — two lines fade to faint dots
    const fade = span(p, AT.codes - S * 0.05, AT.codes + S * 0.45);
    solidMat.opacity = 1 - fade;
    dotMat.opacity = 0.5 * fade;
    // VIII: warm light completes the sheet
    const a = answered(p);
    fills.current.forEach((m, i) => {
      if (!m) return;
      const t = Math.min(1, Math.max(0, a * 1.7 - i * 0.5));
      m.scale.x = Math.max(0.0001, t);
      m.position.x = (W * 0.84 * t) / 2;
    });
    fillMat.color.set("#ffd79a").multiplyScalar(1.5 + Math.sin(clock.elapsedTime * 2) * 0.12);
    // VII: a soft green light rises at the moment of the order
    const g = window4(p, AT.seal - S * 0.2, AT.seal + S * 0.3, AT.accepted, AT.accepted + S * 0.4);
    if (rise.current && riseMat.current) {
      rise.current.position.set(SHEET.x, 0.2 + span(p, AT.seal - S * 0.2, AT.seal + S * 0.5) * 2.6, SHEET.z + 1.4);
      rise.current.scale.setScalar(4 + g * 3);
      riseMat.current.opacity = g * 0.75;
    }
    if (green.current) green.current.intensity = g * 12;
  });
  return (
    <group>
      <group position={SHEET} rotation={[0, -0.14, 0.015]}>
        <RoundedBox args={[3.6, 4.4, 0.1]} radius={0.06} smoothness={4}>
          <Glass lite={lite} tint="#f7faf8" attenuation="#dbe9e3" roughness={0.42} />
        </RoundedBox>
        {NOTE_LINES.map((len, i) => {
          const y = 1.6 - i * 0.44;
          const w = W * len;
          const gap = GAPS.indexOf(i);
          if (gap >= 0)
            return (
              <group key={i} position={[-W / 2, y, 0.07]}>
                <mesh position={[w / 2, 0, 0]} material={solidMat}>
                  <boxGeometry args={[w, 0.05, 0.01]} />
                </mesh>
                {Array.from({ length: 8 }).map((_, j) => (
                  <mesh key={j} position={[0.15 + j * 0.34, 0, 0]} material={dotMat}>
                    <boxGeometry args={[0.08, 0.035, 0.01]} />
                  </mesh>
                ))}
                <mesh ref={(m) => void (fills.current[gap] = m)} position={[0, 0, 0.012]} scale={[0.0001, 1, 1]} material={fillMat}>
                  <boxGeometry args={[W * 0.84, 0.06, 0.012]} />
                </mesh>
              </group>
            );
          return (
            <mesh key={i} position={[-W / 2 + w / 2, y, 0.07]}>
              <boxGeometry args={[w, 0.05, 0.01]} />
              <meshStandardMaterial color="#5d6f6c" roughness={0.9} />
            </mesh>
          );
        })}
      </group>
      <sprite ref={rise}>
        <spriteMaterial ref={riseMat} map={glowTexture()} color={new THREE.Color("#7fe6b0").multiplyScalar(1.6)} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <pointLight ref={green} position={[SHEET.x, 1.6, SHEET.z + 2]} color="#7fe6b0" distance={9} decay={2} intensity={0} />
    </group>
  );
}

// ── II–IX. The tiles: a set of tests, then the codes the claim carries ───────
const TESTS = [
  { code: "M72.2", label: "Plantar fasciitis" },
  { code: "99213", label: "Office visit" },
  { code: "97161", label: "Physio assessment" },
  { code: "0101T", label: "Shockwave therapy" },
  { code: "20550", label: "Tendon injection" },
];
const FLAGGED = new Set([1, 3, 4]); // the three the insurer questions
function Tiles({ lite }: { lite: boolean }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const mats = useRef<(THREE.MeshPhysicalMaterial | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const c = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const p = film.p;
    const settle = span(p, AT.care + S * 0.7, AT.reasoning + S * 0.3);
    const codes = window4(p, AT.codes - S * 0.1, AT.codes + S * 0.3, AT.submitted + S * 0.1, AT.submitted + S * 0.4) + window4(p, AT.seal + S * 0.4, AT.question, AT.accepted + S * 0.3, AT.accepted + S * 0.7);
    const dark = declined(p);
    const amber = window4(p, AT.seal - S * 0.05, AT.seal + S * 0.4, AT.question - S * 0.1, AT.question + S * 0.4);
    const mint = span(p, AT.question, AT.question + S * 0.6);
    groups.current.forEach((g, i) => {
      if (!g) return;
      const s = Math.min(1, Math.max(0, settle * 1.6 - i * 0.15));
      g.position.y = TILE_Y + (1 - s) * 2.2 + Math.sin(clock.elapsedTime * 0.8 + i) * 0.02;
      g.scale.setScalar(Math.max(0.0001, s));
    });
    mats.current.forEach((m, i) => {
      if (!m) return;
      const f = FLAGGED.has(i) ? 1 : 0;
      c.set("#f3faf7")
        .lerp(_c1.set("#5c666b"), dark * f * 0.85)
        .lerp(_c2.set("#ffd28a"), amber * f * (0.75 + Math.sin(clock.elapsedTime * 2.2 + i) * 0.1));
      c.lerp(_c1.set("#bff0d6"), mint * 0.8);
      m.color.copy(c);
      m.attenuationColor.copy(c);
    });
    labels.current.forEach((el) => el && (el.style.opacity = String(Math.min(1, codes))));
  });
  return (
    <group>
      {TESTS.map((t, i) => (
        <group key={t.code} ref={(g) => void (groups.current[i] = g)} position={[TILE_XS[i], TILE_Y, -0.3 + Math.abs(i - 2) * 0.18]} rotation={[0, (2 - i) * 0.06, 0]}>
          <RoundedBox args={[1.5, 1.9, 0.14]} radius={0.07} smoothness={4}>
            <Glass lite={lite} roughness={0.22} matRef={(m) => void (mats.current[i] = m)} />
          </RoundedBox>
          <Html transform position={[0, 0, 0.09]} distanceFactor={3.6} zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
            <div ref={(el) => void (labels.current[i] = el)} className="flex w-[150px] flex-col items-center text-center" style={{ opacity: 0, color: "#2a3a37" }}>
              <div className="dot text-[30px] leading-none">{t.code}</div>
              <div className="mt-2 text-[11px] font-light tracking-wide opacity-70">{t.label}</div>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

// ── VIII. The pane: the right question, at the right time ───────────────────
function Pane({ lite }: { lite: boolean }) {
  const g = useRef<THREE.Group>(null);
  const text = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const v = window4(film.p, AT.question - S * 0.35, AT.question + S * 0.05, AT.accepted + S * 0.1, AT.accepted + S * 0.4);
    if (g.current) {
      g.current.scale.setScalar(Math.max(0.0001, v));
      g.current.position.y = PANE.y + (1 - v) * 0.4;
    }
    if (text.current) text.current.style.opacity = String(v);
  });
  return (
    <group ref={g} position={PANE} rotation={[0, -0.42, 0]}>
      <RoundedBox args={[2.3, 1.3, 0.05]} radius={0.05} smoothness={3}>
        <Glass lite={lite} tint="#f4fbf7" attenuation="#bfe9d3" roughness={0.18} />
      </RoundedBox>
      <Html transform position={[0, 0, 0.04]} distanceFactor={3.2} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div ref={text} className="w-[230px] px-3 text-left" style={{ opacity: 0, color: "#22312e" }}>
          <div className="text-[10px] font-normal tracking-[0.2em] text-[#2f9e62]">SEAL</div>
          <div className="mt-1.5 text-[13px] font-light leading-snug">How long has the pain lasted, and what was tried first?</div>
          <div className="mt-2 text-[13px] font-normal leading-snug text-[#2f9e62]">Six weeks. Rest and physiotherapy.</div>
        </div>
      </Html>
    </group>
  );
}

// ── The claim: a small glass card riding the thread ──────────────────────────
function Card({ lite }: { lite: boolean }) {
  const g = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.SpriteMaterial>(null);
  const mark = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const c = cardAt(film.p);
    const pos = CURVE.getPointAt(uAtX(c.x));
    if (g.current) {
      g.current.position.copy(pos);
      g.current.position.y += 0.45 + Math.sin(clock.elapsedTime * 1.6) * 0.06;
      g.current.rotation.set(0, -0.25 + Math.sin(clock.elapsedTime * 0.7) * 0.15, 0);
      g.current.scale.setScalar(Math.max(0.0001, c.show));
    }
    glowMat.current?.color.set(c.state === "declined" ? "#c97b72" : c.state === "accepted" ? "#f6d58f" : "#ffffff").multiplyScalar(c.state === "declined" ? 0.6 : 1.4);
    mark.current?.color.set(c.state === "declined" ? "#d9564a" : c.state === "accepted" ? "#e9b949" : "#9fb1ad").multiplyScalar(c.state === "out" ? 1 : 1.8);
  });
  return (
    <group ref={g}>
      <RoundedBox args={[1.1, 0.74, 0.06]} radius={0.05} smoothness={3}>
        <Glass lite={lite} roughness={0.2} />
      </RoundedBox>
      <mesh position={[0, -0.18, 0.04]}>
        <boxGeometry args={[0.7, 0.035, 0.01]} />
        <meshBasicMaterial ref={mark} toneMapped={false} />
      </mesh>
      <sprite scale={[2.4, 2.4, 1]}>
        <spriteMaterial ref={glowMat} map={glowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.75} />
      </sprite>
    </group>
  );
}

// ── VI. Across the region: many red-lined cards, gathering in the grey ───────
function Crowd() {
  const N = 42;
  const cards = useRef<THREE.InstancedMesh>(null);
  const lines = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: N }, (_, i) => ({ x: (((i * 73) % 100) / 100 - 0.5) * 26, y: (((i * 37) % 100) / 100) * 6 - 1.5, z: (((i * 53) % 100) / 100 - 0.5) * 9, r: ((i * 29) % 100) / 100, d: ((i * 17) % 100) / 100 })), []);
  const cardMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f7f9fa", emissive: "#e8eef0", emissiveIntensity: 0.35, roughness: 0.3, metalness: 0, transparent: true, opacity: 0 }), []);
  const lineMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#d9564a").multiplyScalar(1.3), toneMapped: false, transparent: true, opacity: 0 }), []);
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const p = film.p;
    const v = window4(p, AT.region - S * 0.5, AT.region + S * 0.1, AT.seal - S * 0.4, AT.seal - S * 0.1);
    cardMat.opacity = v * 0.9;
    lineMat.opacity = v;
    if (!cards.current || !lines.current) return;
    seeds.forEach((s, i) => {
      const arrive = Math.min(1, Math.max(0, v * 1.8 - s.d * 0.8));
      m.position.set(CROWD.x + s.x, CROWD.y + s.y + (1 - arrive) * 3 + Math.sin(clock.elapsedTime * 0.6 + i) * 0.08, CROWD.z + s.z);
      m.rotation.set(0, -0.4 + s.r * 0.8, (s.r - 0.5) * 0.2);
      m.scale.setScalar(Math.max(0.0001, arrive));
      m.updateMatrix();
      cards.current!.setMatrixAt(i, m.matrix);
      m.position.y -= 0.18 * arrive;
      m.translateZ(0.04);
      m.updateMatrix();
      lines.current!.setMatrixAt(i, m.matrix);
    });
    cards.current.instanceMatrix.needsUpdate = true;
    lines.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={cards} args={[undefined, cardMat, N]} frustumCulled={false}>
        <boxGeometry args={[1.1, 0.74, 0.05]} />
      </instancedMesh>
      <instancedMesh ref={lines} args={[undefined, lineMat, N]} frustumCulled={false}>
        <boxGeometry args={[0.7, 0.035, 0.01]} />
      </instancedMesh>
    </group>
  );
}

function Insurer({ lite }: { lite: boolean }) {
  return (
    <group position={INSURER}>
      <RoundedBox args={[3, 16, 3]} radius={0.12} smoothness={3}>
        <Glass lite={lite} tint="#e6edf1" attenuation="#a9bcc8" roughness={0.35} />
      </RoundedBox>
    </group>
  );
}

// ── Camera, fog ──────────────────────────────────────────────────────────────
function Rig() {
  const { camera, size, scene } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const lean = useRef({ x: 0, y: 0 });
  useMemo(() => {
    scene.fog = new THREE.FogExp2("#dde6e3", 0.05);
    scene.background = new THREE.Color("#dde6e3");
  }, [scene]);
  useFrame(({ clock, pointer }, dt) => {
    film.p += (film.target - film.p) * (1 - Math.exp(-dt * 2.6));
    const k = keyAt(film.p);
    POS.getPoint(k.t, pos);
    LOOK.getPoint(k.t, look);
    // Phones see a narrow slice of the scene: widen the lens so the whole row of glass fits across
    // the screen, centre each object, and keep it clear of the words.
    const aspect = size.width / size.height;
    const portrait = aspect < 1;
    const fov = portrait ? Math.min(62, 34 + (1 - aspect) * 46) : 34;
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (portrait) {
      const dx = SHIFT_M.getPoint(k.t).x;
      pos.x += dx;
      look.x += dx;
      pos.sub(look).multiplyScalar(1.45).add(look);
      // story chapters: objects in the top half (words below); closing chapters: below the words
      const closing = span(film.p, AT.numbers - S * 0.4, AT.numbers);
      look.y += -4.3 * (1 - closing) + 1.8 * closing;
    }
    lean.current.x += (pointer.x - lean.current.x) * 0.03;
    lean.current.y += (pointer.y - lean.current.y) * 0.03;
    pos.x += Math.sin(clock.elapsedTime * 0.13) * 0.25 + lean.current.x * 0.5;
    pos.y += Math.sin(clock.elapsedTime * 0.19) * 0.12 + lean.current.y * 0.25;
    camera.position.copy(pos);
    camera.lookAt(look);
    (scene.fog as THREE.FogExp2).color.copy(k.bg);
    (scene.fog as THREE.FogExp2).density = k.fog;
    (scene.background as THREE.Color).copy(k.bg);
  });
  return null;
}

export default function FilmScene({ lite }: { lite: boolean }) {
  return (
    <Canvas dpr={lite ? [1, 1.25] : [1, 1.75]} camera={{ fov: 34, near: 0.3, far: 600, position: [-3.5, 2.6, 12.5] }} gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
      <Rig />
      <ambientLight intensity={0.55} />
      <directionalLight position={[20, 30, 18]} intensity={0.9} color="#fffaf2" />
      {/* soft studio light for the glass, generated in place (no image files) */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 8, 6]} scale={[14, 6, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.6} position={[-10, 3, 2]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} color="#e8fff3" />
        <Lightformer form="rect" intensity={1.4} position={[10, 3, -2]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} color="#fff3e0" />
        <Lightformer form="ring" intensity={2} position={[0, 6, -10]} scale={6} color="#ffffff" />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[60, 0, 0]}>
        <planeGeometry args={[600, 300]} />
        <meshStandardMaterial color="#e9eeeb" roughness={1} />
      </mesh>
      <ContactShadows position={[PEBBLE.x, 0.01, PEBBLE.z]} scale={8} blur={2.8} far={4} opacity={0.35} frames={1} />
      <ContactShadows position={[SHEET.x, 0.01, -1]} scale={14} blur={3} far={6} opacity={0.25} frames={1} />
      <Thread />
      <ThreadField />
      <Pebble lite={lite} />
      <Sheet lite={lite} />
      <Tiles lite={lite} />
      <Pane lite={lite} />
      <Card lite={lite} />
      <Crowd />
      <Insurer lite={lite} />
      {!lite && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.86} luminanceSmoothing={0.2} radius={0.75} />
          <Noise opacity={0.045} premultiply />
          <Vignette offset={0.32} darkness={0.32} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
