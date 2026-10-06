import * as THREE from 'three'
import { HASH, NOISE, SDF2 } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm, rt } from './post'

/* ==========================================================================
   THE SCALE — Figure 4.2 as a fall through eleven powers of ten.
   One flat world, measured in metres. Every object sits beside the last
   at its true relative size, and the camera's view height H shrinks from
   about 4 m to under a nanometre. Nothing is a texture: each object is a
   small drawing in distance functions, so it stays sharp at any zoom.

   Positions are kept in double precision on the CPU; the shader only ever
   sees each object relative to the camera, in screen heights, so a
   ribosome beside a chicken egg loses nothing to float rounding.

   The hero lives here too: a glass lens over the headline and Hooke's
   cork (1665). On scroll the lens slides to the centre and opens until
   the world inside it fills the frame.
   ========================================================================== */

export type LadderItem = {
  key: string
  name: string
  /** characteristic size (m): height, length or diameter */
  size: number
  /** shown on the label */
  sizeText: string
  x: number
  y: number
  /** drawing id, −1 = a focus point only (drawn as part of another object) */
  type: number
  /** half-extent of the drawing in units of size, for culling */
  ext: number
  /** where the camera looks, if not the centre */
  fx?: number
  fy?: number
  /** fraction of the screen height the object fills when in focus */
  fill?: number
}

const L: LadderItem[] = []
const put = (key: string, name: string, size: number, sizeText: string, type: number, ext: number, gapK: number, dy = 0, fill = 0.4) => {
  const prev = L[L.length - 1]
  let x = 0
  if (prev) {
    const prevHalf = prev.type === 5 ? prev.size * 0.5 : prev.size * 0.5
    x = prev.x + prevHalf + gapK * size + size * 0.5
  }
  L.push({ key, name, size, sizeText, x, y: (prev ? prev.y : 0) + dy, type, ext, fill })
}
put('human', 'Human height', 1.75, '≈ 1.7 m', 0, 0.56, 0, 0, 0.5)
put('chicken', 'Chicken egg', 0.057, '≈ 6 cm', 1, 0.56, 1.2, -0.84)
put('frog', 'Frog egg', 0.0018, '≈ 2 mm', 2, 0.8, 0.9, -0.01)
put('egg', 'Human egg', 120e-6, '≈ 0.1 mm', 3, 0.56, 1.0, -0.0003)
put('cell', 'Animal cell', 20e-6, '10–100 µm', 4, 0.56, 1.1, 0, 0.42)
// the nucleus is part of the cell's drawing: a focus point only
L.push({ key: 'nucleus', name: 'Nucleus', size: 5e-6, sizeText: '≈ 5 µm', x: L[4].x - 0.06 * 20e-6, y: L[4].y + 0.015 * 20e-6, type: -1, ext: 0.5, fill: 0.36 })
{
  const cell = L[4]
  L.push({ key: 'bact', name: 'Bacterium', size: 2e-6, sizeText: '1–5 µm', x: cell.x + 0.5 * 20e-6 + 1.6e-6, y: cell.y + 0.6e-6, type: 5, ext: 1.6, fill: 0.36 })
}
put('mito', 'Mitochondrion', 1.5e-6, '1–10 µm long', 6, 0.56, 0.45, -1.1e-6, 0.36)
put('myco', 'Mycoplasma', 0.3e-6, '0.1–1 µm', 7, 0.56, 0.9, 0.4e-6)
put('virus', 'Virus', 100e-9, '≈ 20–300 nm', 8, 0.6, 1.0, 0)
put('ribo', 'Ribosome', 25e-9, '≈ 25 nm', 9, 0.6, 1.0, 0)
put('protein', 'Protein · hemoglobin', 6.5e-9, '≈ 6.5 nm', 10, 0.6, 0.9, 0)
put('lipid', 'Phospholipid', 2.6e-9, '≈ 2.5 nm', 11, 0.56, 0.8, 0)
put('glucose', 'Glucose', 0.9e-9, '≈ 0.9 nm', 12, 0.6, 0.8, 0)
put('atom', 'Carbon atom', 0.15e-9, '≈ 0.15 nm', 13, 0.9, 1.0, 0, 0.4)
export const LADDER = L
/* the bacterium and the mitochondrion share one view, for the "which is bigger?" question */
export const PAIR_FOCUS = { x: (L[6].x + L[7].x) / 2, y: (L[6].y + L[7].y) / 2, H: 6.2e-6 }

/** the camera's resting view height for each item */
const focusH = (it: LadderItem) => it.size / (it.fill ?? 0.4)
/** zoom levels (log10 of view height) at which each item is in focus */
export const ZK = L.map((it) => Math.log10(focusH(it)))
export const Z_TOP = Math.log10(5.5)
export const Z_HUMAN = ZK[0]
export const Z_CELL = ZK[4]
export const Z_ATOM = ZK[ZK.length - 1]

/** subjects sit right of centre: the copy runs down the left */
export const OFFSET_X = 0.07

export type View = { cx: number; cy: number; H: number; Z: number }

/** the camera at zoom Z: it glides from one subject to the next */
export function viewAt(Z: number, out: View = { cx: 0, cy: 0, H: 1, Z: 0 }): View {
  out.Z = Z
  out.H = Math.pow(10, Z)
  const n = L.length
  let fx = L[0].x
  let fy = L[0].y
  if (Z >= ZK[0]) {
    fx = L[0].x
    fy = L[0].y
  } else if (Z <= ZK[n - 1]) {
    fx = L[n - 1].x
    fy = L[n - 1].y
  } else {
    for (let i = 0; i < n - 1; i++) {
      if (Z <= ZK[i] && Z >= ZK[i + 1]) {
        const t = (ZK[i] - Z) / (ZK[i] - ZK[i + 1])
        // pan late: the eye stays on a subject while it grows, then is drawn to the next
        const e = smooth01(Math.pow(t, 0.8))
        fx = L[i].fx ?? L[i].x
        fy = L[i].fy ?? L[i].y
        fx += ((L[i + 1].fx ?? L[i + 1].x) - fx) * e
        fy += ((L[i + 1].fy ?? L[i + 1].y) - fy) * e
        break
      }
    }
  }
  out.cx = fx - OFFSET_X * out.H
  out.cy = fy
  return out
}
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** blend toward a fixed framing (the bacterium–mitochondrion pair) */
export function blendView(v: View, cx: number, cy: number, H: number, k: number) {
  if (k <= 0) return v
  const lz = Math.log10(v.H) + (Math.log10(H) - Math.log10(v.H)) * k
  v.H = Math.pow(10, lz)
  v.Z = lz
  v.cx += (cx - OFFSET_X * v.H - v.cx) * k
  v.cy += (cy - v.cy) * k
  return v
}

/* ---------------------------------------------------------------- shaders
   Each object is its own small shader, drawn as a full-screen pass and
   composited "over" the ones behind it, big to small. (One shader holding
   every drawing was mis-compiled by some GPU drivers.) */
const COMMON = /* glsl */ `
${HASH}${NOISE}${SDF2}
uniform float uTime;
uniform vec2 uRes;
float sq(float x){ return x * x; }
const vec3 BONE = vec3(0.93, 0.92, 0.9);
const vec3 CYAN = vec3(0.35, 0.85, 1.0);
const vec3 BLUE = vec3(0.25, 0.42, 1.0);
const vec3 MAG = vec3(1.0, 0.22, 0.52);
const vec3 GRN = vec3(0.25, 1.0, 0.45);
const vec3 AMB = vec3(1.0, 0.66, 0.18);
const vec3 RED = vec3(1.0, 0.3, 0.2);
const vec3 BAC = vec3(0.35, 1.0, 0.45);
const vec3 LIGHT = vec3(-0.5, 0.62, 0.6);

/* a 2-D shape lit as if it were a dome: shading from the distance field's gradient */
vec3 domeShade(float d, vec2 g, float R, vec3 base, float rimK){
  float h = clamp(-d / R, 0.0, 1.0);
  float z = sqrt(max(1.0 - (1.0 - h) * (1.0 - h), 0.0));
  vec3 n = normalize(vec3(normalize(g + 1e-6) * (1.0 - z), z + 1e-3));
  float dif = max(dot(n, normalize(LIGHT)), 0.0);
  float rim = sq(max(1.0 - n.z, 0.0));
  return base * (0.16 + 0.7 * dif) + base * rim * rimK;
}

`

/** the drawings, indexed by type */
const DRAW: string[] = [
  /* 0 */ `/* ---- 0 · a standing person, for scale, with one nerve cell running down the leg ---- */
float sdHuman(vec2 q){
  q.x = abs(q.x);
  float d = length(q - vec2(0.0, 0.437)) - 0.058;
  d = smin(d, sdSeg(q, vec2(0.0, 0.40), vec2(0.0, 0.34)) - 0.023, 0.02);
  d = smin(d, sdRBox2(q - vec2(0.0, 0.248), vec2(0.097, 0.072), 0.045), 0.03);
  d = smin(d, sdRBox2(q - vec2(0.0, 0.115), vec2(0.074, 0.075), 0.035), 0.04);
  d = smin(d, sdRBox2(q - vec2(0.0, 0.025), vec2(0.084, 0.045), 0.035), 0.03);
  d = smin(d, sdSeg(q, vec2(0.111, 0.298), vec2(0.138, 0.13)) - 0.026, 0.02);
  d = smin(d, sdSeg(q, vec2(0.138, 0.13), vec2(0.151, -0.02)) - 0.02, 0.015);
  d = smin(d, length(q - vec2(0.154, -0.046)) - 0.021, 0.014);
  d = smin(d, sdSeg(q, vec2(0.047, 0.0), vec2(0.052, -0.215)) - 0.042, 0.02);
  d = smin(d, sdSeg(q, vec2(0.052, -0.215), vec2(0.054, -0.452)) - 0.029, 0.02);
  d = smin(d, sdSeg(q, vec2(0.054, -0.472), vec2(0.086, -0.484)) - 0.016, 0.012);
  return d;
}
vec4 drawHuman(vec2 q, float px){
  float d = sdHuman(q);
  vec4 c = vec4(0.0);
  float a = fillA(d, px);
  c.rgb = vec3(0.012, 0.016, 0.022) * a + BONE * exp(min(d, 0.0) / 0.012) * 0.06 * a;
  c.a = a * 0.92;
  c.rgb += BONE * strokeA(d, 0.0018, px) * 0.9 + BONE * exp(-abs(d) / 0.01) * 0.08;
  // the sciatic nerve: one cell, from the lower spine to the foot
  vec2 P[7] = vec2[7](vec2(0.012, 0.05), vec2(0.035, 0.0), vec2(0.05, -0.12), vec2(0.052, -0.215), vec2(0.053, -0.33), vec2(0.054, -0.45), vec2(0.076, -0.48));
  float dn = 1e9;
  for (int i = 0; i < 6; i++) dn = min(dn, sdSeg(q, P[i], P[i + 1]));
  float pulse = 0.6 + 0.4 * sin(q.y * 90.0 + uTime * 6.0);
  vec3 NERVE = vec3(1.0, 0.25, 0.3);
  c.rgb += NERVE * (strokeA(dn, 0.0012, px) * 1.4 * pulse + exp(-dn / 0.006) * 0.12);
  float ds = length(q - P[0]) - 0.006;
  c.rgb += NERVE * (fillA(ds, px) * 2.0 + exp(-max(ds, 0.0) / 0.01) * 0.25);
  for (int i = 0; i < 5; i++) {
    float an = float(i) * 1.3 + 0.5;
    c.rgb += NERVE * strokeA(sdSeg(q, P[0], P[0] + vec2(cos(an), sin(an)) * 0.016), 0.0007, px) * 0.8;
  }
  return c;
}

`,
  /* 1 */ `/* ---- 1 · a chicken egg, candled from behind ---- */
float sdEgg(vec2 q){
  vec2 e = vec2(q.x / (0.385 * (1.0 + 0.11 * q.y / 0.5)), q.y / 0.5);
  return (length(e) - 1.0) * 0.36;
}
vec4 drawChicken(vec2 q, float px){
  float d = sdEgg(q);
  if (d > 0.08) return vec4(0.0);
  vec2 g = vec2(sdEgg(q + vec2(0.002, 0.0)) - d, sdEgg(q + vec2(0.0, 0.002)) - d);
  float a = fillA(d, px);
  vec3 shell = vec3(0.98, 0.84, 0.64);
  vec3 c = domeShade(d, g, 0.25, shell, 1.4);
  c *= 0.85 + 0.15 * fbm2(q * 60.0, 3);
  c -= vec3(0.1, 0.08, 0.06) * smoothstep(0.62, 0.7, vnoise(q * 140.0)) * 0.6;
  // light through the shell: the yolk and the air cell at the blunt end
  float yolk = exp(-sq(length(q - vec2(0.02, -0.04)) / 0.17));
  c += vec3(1.0, 0.5, 0.12) * yolk * 0.22;
  float air = fillA(length(q - vec2(0.0, 0.47)) - 0.15, 0.02) * a;
  c += vec3(0.4, 0.42, 0.45) * air * 0.12;
  vec4 o = vec4(c * a, a);
  o.rgb += shell * exp(-abs(d) / 0.008) * 0.12;
  return o;
}

`,
  /* 2 */ `/* ---- 2 · a frog egg: pigmented animal pole, pale vegetal pole, a coat of jelly ---- */
vec4 drawFrog(vec2 q, float px){
  float r = length(q);
  float d = r - 0.5;
  vec4 o = vec4(0.0);
  float dj = r - 0.74 - 0.01 * sin(atan(q.y, q.x) * 7.0 + 1.0);
  float ja = fillA(dj, px);
  o.rgb = vec3(0.35, 0.5, 0.6) * ja * 0.05 + vec3(0.5, 0.7, 0.85) * strokeA(dj, 0.002, px) * 0.35;
  o.a = ja * 0.25;
  float a = fillA(d, px);
  vec2 g = q / max(r, 1e-4);
  float pig = smoothstep(-0.06, 0.08, q.y + 0.08 + 0.03 * sin(q.x * 14.0));
  vec3 base = mix(vec3(0.82, 0.78, 0.64), vec3(0.06, 0.045, 0.04), pig);
  vec3 c = domeShade(d, g, 0.5, base, 0.9);
  c += vec3(1.0) * pow(max(1.0 - length(q - vec2(-0.17, 0.2)) / 0.09, 0.0), 2.0) * 0.6;
  o = over(vec4(c * a, a), o);
  return o;
}

`,
  /* 3 */ `/* ---- 3 · a human egg: zona pellucida, a crown of follicle cells ---- */
vec4 drawHumanEgg(vec2 q, float px){
  float r = length(q);
  vec4 o = vec4(0.0);
  // corona radiata: two loose rings of small cells
  float an = atan(q.y, q.x);
  for (int ring = 0; ring < 2; ring++) {
    float n = ring == 0 ? 26.0 : 32.0;
    float R0 = ring == 0 ? 0.44 : 0.5;
    float k = floor(an / 6.2832 * n + 0.5);
    for (int j = -1; j <= 1; j++) {
      float kk = k + float(j);
      vec3 h = hash32(vec2(kk, float(ring) + 3.0));
      float aa = kk / n * 6.2832 + (h.x - 0.5) * 0.08;
      vec2 cc = vec2(cos(aa), sin(aa)) * (R0 + (h.y - 0.5) * 0.03);
      vec2 lq = rot2(aa) * (q - cc);
      float dc = length(lq / vec2(0.032, 0.022)) - 1.0;
      dc *= 0.022;
      float ca = fillA(dc, px);
      vec3 col = vec3(0.95, 0.82, 0.86) * (0.25 + 0.5 * exp(min(dc, 0.0) / 0.01)) + vec3(0.6, 0.5, 0.9) * fillA(length(lq) - 0.008, px) * 0.6;
      o = over(vec4(col * ca * 0.7, ca * 0.7), o);
    }
  }
  // zona pellucida: a thick translucent shell
  float dz = abs(r - 0.37) - 0.035;
  float za = fillA(dz, px);
  o = over(vec4(vec3(0.6, 0.72, 0.9) * (0.12 + 0.35 * exp(-abs(dz + 0.035) / 0.006) + 0.25 * exp(-abs(dz) / 0.004)) * za, za * 0.6), o);
  // the egg's cytoplasm, granular
  float d = r - 0.33;
  float a = fillA(d, px);
  vec3 c = vec3(0.95, 0.86, 0.82) * (0.22 + 0.3 * fbm2(q * 40.0, 4)) + vec3(1.0, 0.9, 0.85) * exp(d / 0.02) * 0.3;
  float dn = length(q - vec2(0.09, 0.06)) - 0.075;
  c = mix(c, vec3(0.5, 0.55, 0.95) * 0.5, fillA(dn, px) * 0.8);
  c += vec3(0.7, 0.75, 1.0) * strokeA(dn, 0.003, px) * 0.6 + vec3(0.6, 0.6, 1.0) * fillA(length(q - vec2(0.1, 0.07)) - 0.022, px) * 0.7;
  o = over(vec4(c * a, a), o);
  // first polar body in the gap under the zona
  float dp = length(q - vec2(-0.2, 0.25)) - 0.03;
  o.rgb += vec3(0.9, 0.85, 0.85) * fillA(dp, px) * 0.4;
  return o;
}

`,
  /* 4 */ `/* ---- 4 · an animal cell, laid out like the 3-D cell it becomes ---- */
vec4 drawCell(vec2 q, float px, float seed){
  float an = atan(q.y, q.x);
  float r = length(q);
  float wob = 0.012 * sin(an * 5.0 + 1.3) + 0.008 * sin(an * 9.0 - 0.7);
  float d = r - 0.47 - wob;
  float a = fillA(d, px);
  vec3 c = vec3(0.02, 0.025, 0.035) + vec3(0.25, 0.3, 0.4) * fbm2(q * 30.0, 3) * 0.06;
  vec2 NC = vec2(-0.06, 0.015);
  vec2 GC = vec2(0.18, 0.08);
  vec2 nq = q - NC;
  float nr = length(nq);
  float nan = atan(nq.y, nq.x);
  float gan = atan(GC.y - NC.y, GC.x - NC.x);
  float toG = abs(mod(nan - gan + 3.1416, 6.2832) - 3.1416);
  // rough ER: green sheets wrapped round the nucleus, studded with ribosomes, none on the Golgi side
  for (int k = 0; k < 4; k++) {
    float R = 0.17 + float(k) * 0.022 + 0.004 * sin(nan * 7.0 + float(k));
    float mask = smoothstep(0.25, 0.5, vnoise(vec2(nan * 3.0, float(k) * 7.0))) * smoothstep(0.75, 1.0, toG);
    c += GRN * strokeA(nr - R, 0.0022, px) * mask * 0.85;
    c += vec3(0.8, 1.0, 0.8) * fillA(length(vec2((fract(nan * 26.0) - 0.5) / 26.0 * R, nr - R - 0.006)) - 0.0028, px) * mask * 0.7;
  }
  // smooth ER, tubules further out
  c += vec3(0.45, 0.95, 0.75) * strokeA(fbm2(q * 18.0 + 3.0, 3) - 0.52, 0.006, 0.01) * smoothstep(0.42, 0.28, length(q - vec2(-0.22, -0.26))) * 0.5;
  // Golgi: cisternae curving round the nucleus, on its far side
  for (int k = 0; k < 5; k++) {
    float R = length(GC - NC) - 0.035 + float(k) * 0.016;
    float m = smoothstep(0.36 - float(k) * 0.03, 0.26 - float(k) * 0.03, toG);
    c += AMB * strokeA(nr - R, 0.0034, px) * m * 0.95;
  }
  // mitochondria
  for (int i = 0; i < 9; i++) {
    vec3 h = hash32(vec2(float(i), seed + 11.0));
    vec2 cc = vec2(cos(h.x * 6.28), sin(h.x * 6.28)) * (0.27 + 0.13 * h.y);
    if (length(cc - NC) < 0.27 || length(cc - GC) < 0.08) cc = vec2(-cc.x, -cc.y) * 0.95 + vec2(0.05, 0.0);
    vec2 lq = rot2(h.z * 6.28) * (q - cc);
    float dm = sdSeg(lq, vec2(-0.028, 0.0), vec2(0.028, 0.0)) - 0.018;
    c += MAG * (fillA(dm, px) * 0.25 + strokeA(dm, 0.002, px) * 0.9);
    c += MAG * strokeA(abs(fract(lq.x * 60.0) - 0.5) / 60.0, 0.002, px) * step(dm, -0.004) * 0.35;
  }
  // lysosomes and peroxisomes
  for (int i = 0; i < 7; i++) {
    vec3 h = hash32(vec2(float(i), seed + 5.0));
    vec2 cc = (h.xy - 0.5) * 0.7;
    if (length(cc - NC) < 0.26 || length(cc) > 0.42) continue;
    float dl = length(q - cc) - 0.012 - 0.006 * h.z;
    c += (i < 4 ? RED : vec3(1.0, 0.95, 0.45)) * (fillA(dl, px) * 0.8 + exp(-max(dl, 0.0) / 0.01) * 0.1);
  }
  // nucleus: double envelope, chromatin, nucleolus
  float dn = nr - 0.145;
  float na = fillA(dn, px);
  vec3 nc = BLUE * (0.18 + 0.35 * fbm2(nq * 50.0, 4)) * na;
  nc += vec3(0.4, 0.5, 1.0) * fillA(length(nq - vec2(0.035, 0.028)) - 0.03, px) * 0.6;
  c = mix(c, nc, na * 0.9);
  c += BLUE * (strokeA(dn, 0.0025, px) + strokeA(dn - 0.007, 0.0015, px) * 0.7) * 1.1;
  vec4 o = vec4(c * a, a);
  o.rgb += CYAN * (strokeA(d, 0.0025, px) * 1.4 + exp(-abs(d) / 0.012) * 0.18);
  return o;
}

`,
  /* 5 */ `/* ---- 5 · a rod-shaped bacterium: capsule, wall, nucleoid, flagellum, fimbriae ---- */
vec4 drawBact(vec2 q, float px){
  vec4 o = vec4(0.0);
  // flagellum, trailing from the left pole
  float fx = q.x + 0.5;
  if (fx < 0.02 && fx > -1.25) {
    float y = 0.05 + 0.07 * sin(fx * 14.0 + uTime * 9.0) * smoothstep(0.0, -0.15, fx);
    float df = abs(q.y - y) / sqrt(1.0 + sq(0.98 * cos(fx * 14.0 + uTime * 9.0)));
    o.rgb += BAC * strokeA(df, 0.003, px) * 0.8;
  }
  float d = sdSeg(q, vec2(-0.31, 0.0), vec2(0.31, 0.0)) - 0.18;
  // fimbriae: short, straight hairs
  float an = atan(q.y, q.x * 0.6);
  float k = floor(an / 6.2832 * 48.0 + 0.5);
  float ah = k / 48.0 * 6.2832;
  float hairs = step(d, 0.045) * step(-0.002, d) * smoothstep(0.012, 0.0, abs(fract(an / 6.2832 * 48.0 + 0.5) - 0.5) * 0.08);
  o.rgb += BAC * hairs * 0.35;
  // capsule
  float dc = d - 0.04;
  float ca = fillA(dc, px);
  o = over(vec4(vec3(0.2, 0.4, 0.3) * 0.08 * ca + BAC * strokeA(dc, 0.002, px) * 0.15, ca * 0.3), o);
  float a = fillA(d, px);
  vec3 c = vec3(0.02, 0.05, 0.03);
  // nucleoid: a tangle of DNA with no membrane round it
  float nm = smoothstep(0.1, 0.0, sdSeg(q, vec2(-0.15, 0.0), vec2(0.15, 0.0)) - 0.06);
  float t1 = abs(fbm2(q * 34.0 + 5.0, 3) - 0.5);
  c += vec3(0.5, 0.8, 1.0) * smoothstep(0.03, 0.0, t1) * nm * 0.6;
  // ribosomes
  vec2 gr = q * 70.0;
  vec2 cell = floor(gr);
  vec2 hh = hash22(cell);
  float dr = length(fract(gr) - 0.2 - hh * 0.6) / 70.0 - 0.0035;
  c += vec3(0.85, 1.0, 0.8) * fillA(dr, px) * step(0.45, hh.x) * (1.0 - nm * 0.7) * 0.5;
  o = over(vec4(c * a, a), o);
  o.rgb += BAC * (strokeA(d, 0.006, px) * 1.0 + strokeA(d + 0.02, 0.002, px) * 0.6 + exp(-abs(d) / 0.02) * 0.1);
  return o;
}

`,
  /* 6 */ `/* ---- 6 · a mitochondrion: outer membrane, folded inner membrane ---- */
vec4 drawMito(vec2 q, float px){
  q = rot2(0.25) * q;
  float d = sdSeg(q, vec2(-0.3, 0.0), vec2(0.3, 0.0)) - 0.165;
  float a = fillA(d, px);
  vec3 c = MAG * (0.08 + 0.06 * fbm2(q * 40.0, 3));
  float di = d + 0.025;
  // cristae: folds of the inner membrane reaching in from alternate sides
  float cx = q.x * 11.0;
  float kk = floor(cx + 0.5);
  float side = mod(kk, 2.0) * 2.0 - 1.0;
  float fold = sdSeg(vec2((cx - kk) / 11.0, q.y), vec2(0.0, side * 0.14), vec2(0.0, -side * 0.04)) - 0.006;
  float inner = smin(-di, fold, 0.01);
  c += MAG * strokeA(inner, 0.0035, px) * 1.2 * step(abs(q.x), 0.42);
  c += MAG * strokeA(di, 0.003, px) * 0.9;
  // mitochondrial DNA and ribosomes in the matrix
  for (int i = 0; i < 4; i++) {
    vec3 h = hash32(vec2(float(i), 7.0));
    c += vec3(1.0, 0.95, 0.5) * fillA(length(q - vec2((h.x - 0.5) * 0.5, (h.y - 0.5) * 0.16)) - 0.012, px) * 0.6;
  }
  vec4 o = vec4(c * a, a);
  o.rgb += MAG * (strokeA(d, 0.004, px) * 1.4 + exp(-abs(d) / 0.02) * 0.12);
  return o;
}

`,
  /* 7 */ `/* ---- 7 · a mycoplasma: no wall, one membrane, very little inside ---- */
vec4 drawMyco(vec2 q, float px){
  float an = atan(q.y, q.x);
  float d = length(q) - 0.4 - 0.025 * sin(an * 3.0 + 1.0) - 0.015 * sin(an * 5.0);
  float a = fillA(d, px);
  vec3 c = vec3(0.02, 0.04, 0.03);
  c += vec3(0.5, 0.8, 1.0) * smoothstep(0.035, 0.0, abs(fbm2(q * 14.0 + 1.0, 3) - 0.5)) * smoothstep(0.25, 0.1, length(q)) * 0.5;
  vec2 gr = q * 16.0;
  vec2 hh = hash22(floor(gr) + 4.0);
  c += vec3(0.85, 1.0, 0.8) * fillA(length(fract(gr) - 0.2 - hh * 0.6) / 16.0 - 0.012, px) * step(0.5, hh.y) * 0.6;
  vec4 o = vec4(c * a, a);
  o.rgb += vec3(0.6, 1.0, 0.7) * (strokeA(d, 0.006, px) * 1.2 + exp(-abs(d) / 0.03) * 0.12);
  return o;
}

`,
  /* 8 */ `/* ---- 8 · an enveloped virus: spikes, membrane, capsid, genome ---- */
vec4 drawVirus(vec2 q, float px){
  float r = length(q);
  float an = atan(q.y, q.x);
  vec3 V = vec3(0.3, 1.0, 0.85);
  vec4 o = vec4(0.0);
  float n = 34.0;
  float k = floor(an / 6.2832 * n + 0.5);
  float a0 = k / n * 6.2832;
  vec2 dir = vec2(cos(a0), sin(a0));
  float ds = sdSeg(q, dir * 0.37, dir * 0.46) - 0.008;
  float dk = length(q - dir * 0.475) - 0.022;
  float sp = min(ds, dk);
  o.rgb += V * (fillA(sp, px) * 0.9 + exp(-max(sp, 0.0) / 0.01) * 0.1);
  o.a = fillA(sp, px);
  float d = r - 0.37;
  float a = fillA(d, px);
  vec3 c = vec3(0.02, 0.05, 0.05);
  float dh = sdHex(rot2(0.2) * q, 0.21);
  c += V * (strokeA(dh, 0.006, px) * 0.8 + fillA(dh, px) * 0.06);
  c += vec3(1.0, 0.6, 0.4) * smoothstep(0.04, 0.0, abs(fbm2(q * 16.0 + 2.0, 3) - 0.5)) * fillA(dh + 0.02, px) * 0.6;
  o = over(vec4(c * a, a), o);
  o.rgb += vec3(0.6, 0.9, 1.0) * (strokeA(d, 0.008, px) + strokeA(d + 0.025, 0.006, px) * 0.6) * 1.1;
  return o;
}

`,
  /* 9 */ `/* ---- 9 · a ribosome reading mRNA: large and small subunit ---- */
vec4 drawRibo(vec2 q, float px){
  vec4 o = vec4(0.0);
  // mRNA threading between the subunits
  float dm = abs(q.y + 0.07 - 0.02 * sin(q.x * 14.0 + uTime * 1.5));
  o.rgb += vec3(1.0, 0.5, 0.3) * (strokeA(dm, 0.008, px) * 0.9) * step(abs(q.x), 0.62);
  o.a = strokeA(dm, 0.008, px);
  // the growing polypeptide leaves through a tunnel in the large subunit
  for (int i = 0; i < 9; i++) {
    float t = float(i);
    vec2 b = vec2(0.03 * sin(t * 1.3 + uTime), 0.34 + t * 0.035);
    o.rgb += vec3(1.0, 0.85, 0.5) * fillA(length(q - b) - 0.014, px) * 0.8;
  }
  float ns = fbm2(q * 9.0, 3);
  float dsm = length((q - vec2(0.0, -0.19)) / vec2(0.3, 0.13)) - 1.0;
  dsm = dsm * 0.13 + (ns - 0.5) * 0.04;
  float dl = length((q - vec2(0.0, 0.1)) / vec2(0.34, 0.24)) - 1.0;
  dl = dl * 0.24 + (fbm2(q * 7.0 + 4.0, 3) - 0.5) * 0.06;
  vec2 g1 = vec2(0.0, 1.0);
  float a1 = fillA(dsm, px);
  vec3 c1 = domeShade(dsm, normalize(q - vec2(0.0, -0.19)), 0.12, vec3(0.85, 0.92, 1.0), 1.2);
  o = over(vec4(c1 * a1, a1), o);
  float a2 = fillA(dl, px);
  vec3 c2 = domeShade(dl, normalize(q - vec2(0.0, 0.1)), 0.2, vec3(1.0, 0.82, 0.42), 1.2);
  c2 *= 0.85 + 0.3 * fbm2(q * 30.0, 3);
  o = over(vec4(c2 * a2, a2), o);
  return o;
}

`,
  /* 10 */ `/* ---- 10 · a protein: hemoglobin, four subunits wound from helices ---- */
vec4 drawProtein(vec2 q, float px){
  vec4 o = vec4(0.0);
  vec2 C[4] = vec2[4](vec2(-0.15, 0.13), vec2(0.15, 0.14), vec2(-0.14, -0.14), vec2(0.15, -0.13));
  for (int i = 0; i < 4; i++) {
    vec2 lq = q - C[i];
    float d = length(lq) - 0.17 - 0.03 * (fbm2(lq * 8.0 + float(i) * 3.0, 3) - 0.5);
    float a = fillA(d, px);
    vec3 base = (i == 0 || i == 3) ? vec3(1.0, 0.36, 0.5) : vec3(0.65, 0.45, 1.0);
    vec3 c = domeShade(d, normalize(lq), 0.15, base, 1.0) * 0.6;
    // α-helices: coiled ribbons across the subunit
    for (int k = 0; k < 3; k++) {
      float ang = float(k) * 1.1 + float(i);
      vec2 rq = rot2(ang) * lq;
      float dh = abs(rq.y - 0.012 * sin(rq.x * 120.0)) - 0.004;
      c += base * strokeA(dh, 0.005, px) * step(abs(rq.x), 0.12) * step(abs(rq.y + float(k - 1) * 0.06), 0.03) * 0.9;
    }
    // heme: an iron-centred ring in a pocket
    float dhm = sdBox2(rot2(0.6) * (lq - vec2(0.05, 0.03)), vec2(0.03));
    c += vec3(1.0, 0.55, 0.15) * fillA(dhm, px) * 0.9;
    o = over(vec4(c * a, a), o);
  }
  return o;
}

`,
  /* 11 */ `/* ---- 11 · a phospholipid: head, glycerol, a straight and a kinked tail ---- */
vec4 drawLipid(vec2 q, float px){
  vec4 o = vec4(0.0);
  vec3 T = vec3(1.0, 0.62, 0.28);
  float dt = 1e9;
  vec2 a0 = vec2(-0.05, 0.18);
  for (int i = 0; i < 12; i++) {
    vec2 a = a0 + vec2((mod(float(i), 2.0)) * 0.03, -float(i) * 0.052);
    vec2 b = a0 + vec2((mod(float(i + 1), 2.0)) * 0.03, -float(i + 1) * 0.052);
    dt = min(dt, sdSeg(q, a, b));
  }
  vec2 b0 = vec2(0.05, 0.18);
  vec2 cur = b0;
  for (int i = 0; i < 12; i++) {
    vec2 dir = i < 5 ? vec2(0.0, -1.0) : normalize(vec2(0.55, -1.0));
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 nxt = cur + dir * 0.052 + perp * (mod(float(i), 2.0) * 2.0 - 1.0) * 0.015;
    dt = min(dt, sdSeg(q, cur, nxt));
    cur = nxt;
  }
  o.rgb += T * (strokeA(dt, 0.008, px) * 1.0 + exp(-dt / 0.02) * 0.08);
  o.a = strokeA(dt, 0.008, px);
  float dg = sdSeg(q, vec2(-0.05, 0.2), vec2(0.05, 0.2)) - 0.025;
  o = over(vec4(vec3(0.6, 0.8, 0.9) * fillA(dg, px), fillA(dg, px)), o);
  float dp = length(q - vec2(0.0, 0.31)) - 0.065;
  float dc = length(q - vec2(0.0, 0.42)) - 0.055;
  vec3 c1 = domeShade(dp, normalize(q - vec2(0.0, 0.31)), 0.06, vec3(1.0, 0.75, 0.3), 1.0);
  vec3 c2 = domeShade(dc, normalize(q - vec2(0.0, 0.42)), 0.05, CYAN, 1.0);
  o = over(vec4(c1 * fillA(dp, px), fillA(dp, px)), o);
  o = over(vec4(c2 * fillA(dc, px), fillA(dc, px)), o);
  return o;
}

`,
  /* 12 */ `/* ---- 12 · glucose: a six-membered ring, ball and stick ---- */
vec4 drawGlucose(vec2 q, float px){
  vec4 o = vec4(0.0);
  vec2 R[6];
  for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + 0.5236; R[i] = vec2(cos(a), sin(a) * 0.62) * 0.2; }
  float db = 1e9;
  for (int i = 0; i < 6; i++) db = min(db, sdSeg(q, R[i], R[(i + 1) % 6]));
  // substituents: OH up or down, CH2OH on carbon 5
  vec2 S[6] = vec2[6](vec2(0.0, 0.0), vec2(0.0, -0.17), vec2(0.0, 0.16), vec2(0.0, -0.17), vec2(0.0, 0.16), vec2(0.0, 0.0));
  float dO = 1e9;
  for (int i = 1; i < 5; i++) {
    vec2 e = R[i] + S[i] + vec2(R[i].x * 0.25, 0.0);
    db = min(db, sdSeg(q, R[i], e));
    dO = min(dO, length(q - e) - 0.04);
  }
  vec2 c6 = R[0] + vec2(0.06, 0.16);
  db = min(db, sdSeg(q, R[0], c6));
  vec2 o6 = c6 + vec2(0.12, 0.04);
  db = min(db, sdSeg(q, c6, o6));
  dO = min(dO, length(q - o6) - 0.04);
  o.rgb += vec3(0.7) * strokeA(db, 0.01, px);
  o.a = strokeA(db, 0.01, px);
  float dC = 1e9;
  for (int i = 0; i < 6; i++) if (i != 5) dC = min(dC, length(q - R[i]) - 0.045);
  dC = min(dC, length(q - c6) - 0.045);
  float dR = length(q - R[5]) - 0.048;
  o = over(vec4(vec3(0.55) * fillA(dC, px) + vec3(0.9) * exp(-max(dC + 0.03, 0.0) / 0.01) * 0.2 * fillA(dC, px), fillA(dC, px)), o);
  vec3 OX = vec3(1.0, 0.28, 0.22);
  float ox = fillA(min(dO, dR), px);
  o = over(vec4(OX * ox * (0.6 + 0.6 * exp(min(dO, dR) / 0.02)), ox), o);
  return o;
}

`,
  /* 13 */ `/* ---- 13 · a carbon atom: a cloud of probability, a nucleus far too small to see ---- */
vec4 drawAtom(vec2 q, float px){
  float r = length(q);
  float an = atan(q.y, q.x);
  float s = exp(-r / 0.07) * 0.9;
  float p = sq(cos(an + uTime * 0.05)) * (r / 0.12) * exp(-r / 0.1) * 0.9;
  p += sq(sin(an + uTime * 0.05)) * (r / 0.12) * exp(-r / 0.1) * 0.5;
  float flick = 0.85 + 0.3 * vnoise(q * 90.0 + uTime * 4.0);
  vec3 c = vec3(0.55, 0.75, 1.0) * (s + p) * flick * 0.55;
  c += vec3(1.0) * fillA(r - 0.003, px * 0.6) * 1.5;
  return vec4(c, clamp(s + p, 0.0, 1.0) * 0.6);
}

`
]
const DRAW_NAME = ["drawHuman", "drawChicken", "drawFrog", "drawHumanEgg", "drawCell", "drawBact", "drawMito", "drawMyco", "drawVirus", "drawRibo", "drawProtein", "drawLipid", "drawGlucose", "drawAtom"]

/* one object: its drawing, placed and scaled; premultiplied out */
const objFrag = (type: number, ext: number) => /* glsl */ `
${COMMON}
uniform vec4 uObj;   // x, y (screen heights from centre), size (screen heights), alpha
uniform float uSeed;
${DRAW[type]}
void main(){
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * asp;
  vec2 q = (p - uObj.xy) / uObj.z;
  if (length(q) > ${(ext + 0.15).toFixed(2)}) discard;
  vec4 d = ${DRAW_NAME[type]}(q, (1.0 / uRes.y) / uObj.z${type === 4 ? ', uSeed' : ''});
  d = clamp(d, 0.0, 64.0) * uObj.w;
  o = d;
}`

/* the empty world behind: black, with dust fixed in it, one layer per power of ten */
const BG = /* glsl */ `
${COMMON}
uniform vec4 uDust[3];
void main(){
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * asp;
  float pxS = 1.0 / uRes.y;
  vec3 c = vec3(0.002, 0.003, 0.006) + vec3(0.004, 0.006, 0.011) * max(1.0 - length(p) * 0.8, 0.0);
  for (int i = 0; i < 3; i++) {
    vec4 L = uDust[i];
    if (L.w < 0.003) continue;
    vec2 g = p / L.x + L.yz;
    vec2 cell = floor(g);
    vec3 h = hash32(cell + float(i) * 17.0);
    vec2 sp = fract(g) - 0.15 - h.xy * 0.7;
    float d = length(sp) * L.x;
    c += vec3(0.5, 0.65, 1.0) * exp(-sq(d / (pxS * 1.3))) * h.z * L.w * 0.5;
  }
  o = vec4(c, 1.0);
}`

/* the hero: the cork and the headline under a lens; inside the lens, later, the world */
const HERO = /* glsl */ `
${COMMON}
uniform float uHero, uLensWorld, uHeadAmt, uFade;
uniform vec4 uLens;          // centre (uv), radius (screen heights), magnification
uniform sampler2D uHead, uWorld;
/* ---- the hero: Hooke's cork under a lens ---- */
vec2 corkVor(vec2 p){
  // a jittered brick grid gives the box-like cells Hooke drew
  vec2 s = vec2(0.062, 0.04);
  vec2 g = p / s;
  vec2 i0 = floor(g);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = i0 + vec2(float(x), float(y));
    vec2 h = hash22(c);
    vec2 pt = c + vec2(0.5 + mod(c.y, 2.0) * 0.5, 0.5) + (h - 0.5) * 0.45;
    float d = length((g - pt) * s);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d2 - d1, d1);
}
vec3 cork(vec2 p, float detail){
  vec2 v = corkVor(p + vec2(0.3, 0.1));
  float wall = 1.0 - smoothstep(0.0012 + 0.0008 * detail, 0.0035 + 0.0012 * detail, v.x);
  vec3 c = vec3(0.72, 0.52, 0.3) * wall * (0.25 + 0.6 * detail);
  // the dead cells' empty interiors, lit from behind: brighter near the walls, as boxes are
  float lum = (1.0 - wall) * (0.025 + 0.09 * detail * exp(-v.x / 0.006));
  c += vec3(0.55, 0.36, 0.18) * lum;
  // texture of the walls, visible under the lens
  c *= 0.75 + 0.5 * detail * vnoise(p * 300.0);
  return c;
}
vec3 hero(vec2 p, float detail){
  vec3 c = cork(p, detail) * (0.1 + 0.9 * detail);
  // the headline: a plane 0.6 of the screen wide, a little above centre
  float asp = uRes.x / uRes.y;
  float hw = 0.98 * asp;
  vec2 huv = vec2(p.x / hw + 0.5, (p.y - 0.04) / (hw / 3.428) + 0.5);
  float h = 0.0;
  if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) h = texture(uHead, huv).r;
  c = c * (1.0 - h * 0.85) + vec3(0.93, 0.92, 0.9) * pow(max(h, 0.0), 2.2) * 0.86 * uHeadAmt;
  return c;
}


vec3 world(vec2 p){
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  return texture(uWorld, clamp(p / asp + 0.5, 0.0005, 0.9995)).rgb;
}
void main(){
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * asp;
  vec3 col;
  if (uHero > 0.001) {
    vec2 lc = (uLens.xy - 0.5) * asp;
    float R = uLens.z;
    float d = length(p - lc);
    vec3 outside = hero(p, 0.0);
    if (uLensWorld > 0.999 && d < R * 0.98) outside = vec3(0.0);
    col = outside;
    if (d < R * 1.02) {
      float k = clamp(d / R, 0.0, 1.0);
      // a thick lens: magnification with barrel distortion, dispersion at the edge
      float mag = uLens.w;
      float bar = 1.0 + 0.35 * k * k;
      vec2 pr = lc + (p - lc) / (mag * 0.985) * bar;
      vec2 pg = lc + (p - lc) / mag * bar;
      vec2 pb = lc + (p - lc) / (mag * 1.015) * bar;
      vec3 inH = vec3(hero(pr, 1.0).r, hero(pg, 1.0).g, hero(pb, 1.0).b);
      vec3 inside = inH;
      if (uLensWorld > 0.001) {
        vec2 pw = lc + (p - lc) * (0.86 + 0.14 * k * k);
        inside = mix(inH, world(pw), uLensWorld);
      }
      float inA = smoothstep(R, R - 1.5 / uRes.y, d);
      // the glass: Fresnel at the rim, a key-light highlight, a dark edge
      float rim = smoothstep(0.82, 1.0, k);
      float small = 1.0 - smoothstep(0.3, 0.7, R);
      inside *= 1.0 - 0.35 * rim;
      inside += vec3(0.9, 0.95, 1.0) * rim * rim * rim * 0.12 * small;
      vec2 hl = (p - lc) / R - vec2(-0.42, 0.45);
      inside += vec3(1.0, 0.98, 0.95) * exp(-dot(hl, hl) / 0.012) * 0.22 * small;
      inside += vec3(0.6, 0.8, 1.0) * exp(-sq((k - 0.93) / 0.025)) * 0.08 * small;
      col = mix(col, inside, inA);
      col += vec3(0.85, 0.9, 1.0) * exp(-sq((d - R) * uRes.y / 1.6)) * 0.55;
      col *= 1.0 - 0.6 * exp(-sq((d - R * 1.01) * uRes.y / 5.0)) * (1.0 - inA);
    }
    if (uHero < 0.999) col = mix(world(p), col, uHero);
  } else {
    col = world(p);
  }
  o = vec4(col * uFade, 0.0);
}
`

function headlineTex() {
  const c = document.createElement('canvas')
  c.width = 2400
  c.height = 700
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `560 ${Math.round(c.height * 0.7)}px 'Geist Variable', 'Geist', system-ui, sans-serif`
  ;(g as any).letterSpacing = '-22px'
  g.fillText('Cell', c.width / 2, c.height * 0.53)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  return tex
}

export type Visible = { type: number; x: number; y: number; r: number; a: number; seed: number }

export class Scale {
  bg: FullScreen
  objs: FullScreen[]
  hero: FullScreen
  worldRT = rt()
  view: View = { cx: 0, cy: 0, H: 1, Z: 0 }
  /** screen positions of every ladder item (px), for the labels */
  screen = L.map(() => ({ x: 0, y: 0, r: 0, on: false }))
  lens = new THREE.Vector4(0.6, 0.48, 0.22, 2.4)
  visible: Visible[] = []
  constructor() {
    this.bg = new FullScreen(sm(BG, { uTime: U.uTime, uRes: U.uRes, uDust: { value: Array.from({ length: 3 }, () => new THREE.Vector4()) } }))
    const blend = { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }
    const ext = [0.56, 0.56, 0.8, 0.56, 0.56, 1.6, 0.56, 0.56, 0.6, 0.62, 0.6, 0.56, 0.6, 0.9]
    this.objs = DRAW.map((_, t) => new FullScreen(sm(objFrag(t, ext[t]), { uTime: U.uTime, uRes: U.uRes, uObj: { value: new THREE.Vector4() }, uSeed: { value: 0 } }, blend)))
    this.hero = new FullScreen(
      sm(HERO, {
        uTime: U.uTime, uRes: U.uRes, uHero: { value: 1 }, uLensWorld: { value: 0 }, uHeadAmt: { value: 1 }, uFade: { value: 1 },
        uLens: { value: this.lens }, uHead: { value: headlineTex() }, uWorld: { value: null },
      }),
    )
  }
  resize(w: number, h: number) {
    this.worldRT.setSize(w, h)
  }

  /** place the world for view v; aspect = width / height */
  update(v: View, aspect: number, w: number, h: number) {
    this.view = v
    const halfW = aspect * 0.5
    this.visible.length = 0
    L.forEach((it, i) => {
      const x = (it.x - v.cx) / v.H
      const y = (it.y - v.cy) / v.H
      const r = it.size / v.H
      const s = this.screen[i]
      s.x = (x / aspect + 0.5) * w
      s.y = (0.5 - y) * h
      s.r = r * h
      s.on = r > 0.004 && r < 40 && Math.abs(x) < halfW + r * 0.6 && Math.abs(y) < 0.5 + r * 0.6
      if (it.type < 0) return
      const R = r * it.ext
      const vis = R > 0.0015 && r < 3000 && Math.abs(x) - R < halfW + 0.05 && Math.abs(y) - R < 0.55
      if (!vis) return
      // things much larger than the view fade back so the subject reads
      const big = Math.max(0, Math.log10(r) + 0.1)
      this.visible.push({ type: it.type, x, y, r, a: Math.max(0.06, 1 - big * 1.6), seed: i * 1.7 })
    })
    // dust: one layer per power of ten whose spacing is between 2 % and 80 % of the screen
    const dust = this.bg.mat.uniforms.uDust.value as THREE.Vector4[]
    let k = 0
    const top = Math.floor(v.Z)
    for (let j = top; j >= top - 3 && k < 3; j--) {
      const spacingM = Math.pow(10, j) * 0.5
      const s = spacingM / v.H
      if (s > 0.8 || s < 0.02) continue
      const a = Math.min(1, (0.8 - s) / 0.3) * Math.min(1, (s - 0.02) / 0.03)
      dust[k++].set(s, frac(v.cx / spacingM), frac(v.cy / spacingM), a)
    }
    while (k < 3) dust[k++].set(1, 0, 0, 0)
  }

  /** the world (dust, then every visible object, big to small) */
  private drawWorld(r: THREE.WebGLRenderer, into: THREE.WebGLRenderTarget) {
    this.bg.render(r, into)
    for (const o of this.visible) {
      const f = this.objs[o.type]
      ;(f.mat.uniforms.uObj.value as THREE.Vector4).set(o.x, o.y, o.r, o.a)
      f.mat.uniforms.uSeed.value = o.seed
      f.render(r, into)
    }
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, hero: number, lensWorld: number, headAmt: number) {
    if (hero < 0.001) {
      this.drawWorld(r, target)
      return
    }
    if (lensWorld > 0.001) this.drawWorld(r, this.worldRT)
    const u = this.hero.mat.uniforms
    u.uHero.value = hero
    u.uLensWorld.value = lensWorld
    u.uHeadAmt.value = headAmt
    u.uWorld.value = this.worldRT.texture
    this.hero.render(r, target)
  }

  all() {
    return [this.bg, this.hero, ...this.objs]
  }
}
const frac = (x: number) => x - Math.floor(x)
