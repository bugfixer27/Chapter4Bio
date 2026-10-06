import * as THREE from 'three'
import { HASH, NOISE, SDF3, RAY } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm } from './post'

/* ==========================================================================
   ORGANELLES — 1 unit = 100 nm, raymarched as fluorescent membranes.
   Light is emitted where a ray passes through a membrane, so a membrane
   seen edge-on glows brightest, as in a fluorescence micrograph; the cut
   plane (z = 0) is drawn as a section, each membrane a sharp line and each
   compartment its own fill, as in a textbook diagram. Laid out along x:
     x ≈    0   endosymbiosis: a host cell engulfs an aerobic prokaryote,
                which divides inside it and folds its inner membrane into
                cristae; later a photosynthetic one is taken in too
     x ≈  300   a mitochondrion: smooth outer membrane, inner membrane
                folded into cristae, intermembrane space, matrix with DNA,
                ribosomes and ATP synthase
     x ≈  520   living mitochondria: a branched network fusing and dividing
     x ≈  760   a chloroplast: double envelope, thylakoids stacked in grana
                and joined by stroma lamellae, stroma with DNA, ribosomes,
                starch
     x ≈ 1000   plastids: an amyloplast (starch) and a chromoplast (pigment)
     x ≈ 1220   a peroxisome: one membrane and a crystalline core
   ========================================================================== */

export const ORG_X = { endo: 0, mito: 300, net: 520, chloro: 760, plastid: 1000, perox: 1220 }

const FRAG = /* glsl */ `
${HASH}${NOISE}${SDF3}${RAY}
uniform float uEngulf, uGen, uCrist, uEngulf2, uThyl, uFis, uComp, uCutOn, uCutZ, uFade, uHiDNA, uHiRibo, uDiv;
const float TH = 0.13;
float sq(float x){ return x * x; }

/* each membrane: its signed distance, colour; each compartment: a fill */
struct Hit { float d; vec3 col; float fill; vec3 fcol; };
void addM(inout Hit h, float d, vec3 col){ if (abs(d) < abs(h.d)) { h.d = d; h.col = col; } }

const vec3 C_PM = vec3(0.45, 0.9, 1.0);
const vec3 C_NUC = vec3(0.3, 0.45, 1.0);
const vec3 C_ER = vec3(0.3, 1.0, 0.5);
const vec3 C_MITO = vec3(1.0, 0.25, 0.55);
const vec3 C_CHL = vec3(0.55, 1.0, 0.25);
const vec3 C_PER = vec3(1.0, 0.92, 0.4);

/* ---------- endosymbiosis ---------- */
vec3 aerobeC(int k){
  // the engulfed aerobe and, after each division, its descendants
  vec3 start = vec3(96.0, 14.0, 0.0);
  vec3 inside = vec3(26.0, -16.0, 0.0);
  vec3 c = mix(start, inside, smoothstep(0.2, 1.0, uEngulf));
  float g = uGen;
  float a1 = smoothstep(0.0, 1.0, clamp(g, 0.0, 1.0));
  float a2 = smoothstep(0.0, 1.0, clamp(g - 1.0, 0.0, 1.0));
  vec3 o1 = vec3(0.0, 10.0, 4.0) * a1;
  vec3 o2 = vec3(16.0, 0.0, -6.0) * a2;
  if (k == 1) return c + o1;
  if (k == 2) return c + o2;
  if (k == 3) return c + o1 + o2 + vec3(-30.0, 8.0, 0.0) * a2;
  return c;
}
float aerobeOuter(vec3 p, vec3 c, float split){
  vec3 q = p - c; q.xy = rot(0.5) * q.xy;
  return sdCapsule(q, 5.0, 3.6);
}
vec3 cyanoC(){ return mix(vec3(-96.0, -30.0, 0.0), vec3(-8.0, -34.0, 0.0), smoothstep(0.2, 1.0, uEngulf2)); }

void endo(vec3 p, inout Hit h){
  // the host: a cell with a nucleus and ER (its membranes infolded long before)
  float host = length(p / vec3(1.0, 0.86, 0.9)) - 55.0;
  // pseudopods reach round the aerobe, and later the cyanobacterium
  vec3 ac = aerobeC(0);
  float pod = (abs(length(p - ac) - 9.5) - 2.2);
  pod = max(pod, -dot(normalize(p - vec3(0.0)), normalize(ac)) * length(p) + 40.0 - 30.0 * smoothstep(0.0, 0.6, uEngulf));
  float engulfing = smoothstep(0.0, 0.25, uEngulf) * (1.0 - smoothstep(0.55, 0.8, uEngulf));
  host = mix(host, smin(host, pod, 4.0), engulfing);
  vec3 cc = cyanoC();
  float pod2 = (abs(length(p - cc) - 10.5) - 2.2);
  pod2 = max(pod2, -dot(normalize(p), normalize(cc)) * length(p) + 40.0 - 30.0 * smoothstep(0.0, 0.6, uEngulf2));
  float engulf2 = smoothstep(0.0, 0.25, uEngulf2) * (1.0 - smoothstep(0.55, 0.8, uEngulf2));
  host = mix(host, smin(host, pod2, 4.0), engulf2);
  addM(h, host, C_PM);
  if (host < 0.0) { h.fill = 0.012; h.fcol = vec3(0.2, 0.35, 0.5); }
  // nucleus: a double envelope
  float n = length(p - vec3(-18.0, 8.0, 0.0)) - 17.0;
  addM(h, n, C_NUC);
  addM(h, n - 0.8, C_NUC);
  if (n < 0.0) { h.fill = 0.03; h.fcol = C_NUC; }
  // ER: sheets wrapping the nucleus
  float an = atan(p.y - 8.0, p.x + 18.0);
  for (int k = 0; k < 2; k++) {
    float rr = 21.0 + float(k) * 4.5;
    float e = abs(length(p - vec3(-18.0, 8.0, 0.0)) - rr) - 0.6;
    e = max(e, -cos(an - 2.6) + 0.15);
    addM(h, e, C_ER);
  }
  // the aerobes: two membranes each (the engulfed bacterium's own); cristae as the merger matures
  int nA = uGen < 0.5 ? 1 : uGen < 1.5 ? 2 : 4;
  for (int k = 0; k < 4; k++) {
    if (k >= nA) break;
    vec3 c = aerobeC(k);
    float o = aerobeOuter(p, c, 0.0);
    // dividing: a waist pinches in
    vec3 q = p - c; q.xy = rot(0.5) * q.xy;
    float fiss = k == 0 ? fract(uGen) * step(uGen, 2.0) : 0.0;
    o += 2.2 * smoothstep(0.3, 0.9, fiss) * exp(-sq(q.x / 1.6));
    addM(h, o, C_MITO);
    float inner = o + 0.7;
    // cristae: folds of the inner membrane growing in from the sides
    float cx = q.x * 1.0;
    float kk = floor(cx / 1.6 + 0.5);
    float side = mod(kk, 2.0) * 2.0 - 1.0;
    float slab = max(abs(cx - kk * 1.6) - 0.25, side * q.y - mix(3.0, 0.4, uCrist));
    inner = smax(inner, -slab, 0.25) ;
    addM(h, inner, C_MITO * vec3(1.0, 0.8, 0.9));
    if (inner < 0.0) { h.fill = 0.05; h.fcol = C_MITO; }
    // its own circular DNA
    float dna = abs(length(vec2(length(q.xy - vec2(-1.5, 0.0)) - 1.1, q.z)) - 0.08);
    if (inner < 0.0) addM(h, dna - 0.05, vec3(1.0, 0.95, 0.4) * (1.0 + 2.0 * uHiDNA));
  }
  // the photosynthetic prokaryote: its own membranes and thylakoids
  if (uEngulf2 > 0.001) {
    vec3 q = p - cc;
    float o = length(q / vec3(1.0, 0.8, 0.8)) - 8.0;
    addM(h, o, C_CHL);
    addM(h, o + 0.7, C_CHL);
    // concentric thylakoids that stack into grana as it becomes a chloroplast
    float th = abs(length(q / vec3(1.0, 0.8, 0.8)) - 5.5) - 0.12;
    float stacks = abs(fract(q.y * 1.6) - 0.5) / 1.6 - 0.08;
    float gr = max(stacks, length(vec2(abs(q.x) - 3.0, q.z)) - 1.8);
    th = mix(th, min(gr, max(abs(q.y) - 0.1, abs(q.x) - 3.0)), uThyl);
    th = max(th, o + 1.2);
    addM(h, th, C_CHL * 1.2);
    if (o < -0.7) { h.fill = 0.05; h.fcol = C_CHL; }
  }
}

/* ---------- a mitochondrion: outer membrane, inner membrane with cristae, two compartments ---------- */
float mitoMatrix(vec3 q){
  float inner = sdCapsule(q, 7.5, 4.55);
  float kk = floor(q.x / 1.7 + 0.5);
  float side = mod(kk, 2.0) * 2.0 - 1.0;
  if (abs(q.x) < 9.0) {
    float slab = max(abs(q.x - kk * 1.7) - 0.2, side * q.y - (-1.2 + 0.6 * sin(kk * 2.1)));
    slab = max(slab, abs(q.z) - 3.6 * sqrt(max(1.0 - sq(q.y / 4.6), 0.0)) + 0.1);
    inner = smax(inner, -slab, 0.2);
  }
  return inner;
}
void mito(vec3 p, inout Hit h){
  vec3 q = p - vec3(${ORG_X.mito}.0, 0.0, 0.0);
  float outer = sdCapsule(q, 7.5, 5.0);
  addM(h, outer, C_MITO);
  float mx = mitoMatrix(q);
  addM(h, mx, mix(C_MITO, vec3(1.0, 0.55, 0.75), 0.4));
  if (outer < 0.0 && mx > 0.0) { h.fill = 0.02 + 0.08 * step(0.5, uComp) * step(uComp, 1.5); h.fcol = vec3(1.0, 0.6, 0.8); }
  if (mx < 0.0) {
    h.fill = 0.045 + 0.08 * step(1.5, uComp); h.fcol = C_MITO;
    // mtDNA: little circles in the matrix
    for (int k = 0; k < 3; k++) {
      vec3 c = vec3(-4.0 + float(k) * 4.0, 0.6 - float(k) * 0.9, 0.2 * float(k) - 0.4);
      vec3 r = q - c;
      float dna = length(vec2(length(r.xy) - 0.55, r.z)) - 0.045;
      addM(h, dna, vec3(1.0, 0.95, 0.4) * (1.0 + 2.5 * uHiDNA));
    }
  }
}

/* ---------- living mitochondria: a branched network that fuses and divides ---------- */
void network(vec3 p, inout Hit h){
  vec3 q = p - vec3(${ORG_X.net}.0, 0.0, 0.0);
  float t = uTime * 0.15;
  float d = 1e9;
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    vec3 a = vec3(sin(fk * 2.1 + t) * 22.0, cos(fk * 1.7 + t * 0.8) * 14.0, sin(fk * 3.1) * 6.0);
    vec3 b = a + vec3(cos(fk * 1.3 + t * 0.6), sin(fk * 2.3 + t * 0.5), 0.2) * 16.0;
    float seg = sdSeg3(q, a, b) - 1.8;
    // one segment pinches in two, now and then
    float mid = length(q - (a + b) * 0.5);
    seg += (k == 2 ? 2.2 * uFis : 0.0) * exp(-sq(mid / 1.5));
    d = smin(d, seg, 2.4);
  }
  addM(h, d, C_MITO);
  addM(h, d + 0.6, C_MITO * 0.8);
  if (d < -0.6) { h.fill = 0.04; h.fcol = C_MITO; }
}

/* ---------- a chloroplast: double envelope, grana, lamellae, stroma ---------- */
float thylakoids(vec3 q){
  float T = 1e9;
  for (int g = 0; g < 14; g++) {
    float fg = float(g);
    vec2 gc = vec2(-19.0 + mod(fg, 7.0) * 6.3, fg < 7.0 ? -4.0 : 4.5) + vec2(sin(fg * 3.7), cos(fg * 2.3)) * 0.8;
    vec3 r = q - vec3(gc.x, 0.4 * sin(fg), gc.y);
    float cyl = length(r.xz) - 2.3;
    float stack = abs(fract(r.y / 0.42 + 0.5) - 0.5) * 0.42 - 0.07;
    float disc = max(max(cyl, stack), abs(r.y) - 1.9 - 0.2 * sin(fg * 1.3));
    T = min(T, disc);
  }
  // stroma lamellae: flat sheets joining the grana
  float lam = abs(q.y - 0.3 * sin(q.x * 0.25)) - 0.07;
  float lmask = abs(fract(q.z / 4.25 + 0.5) - 0.5) * 4.25 - 0.4;
  T = min(T, max(lam, max(lmask, abs(q.x) - 20.5)));
  return T;
}
void chloro(vec3 p, inout Hit h){
  vec3 q = p - vec3(${ORG_X.chloro}.0, 0.0, 0.0);
  float env = sdEll(q, vec3(25.0, 8.5, 14.0));
  addM(h, env, C_CHL);
  addM(h, env + 0.35, C_CHL * 0.85);
  if (env < -0.35) {
    float T = max(thylakoids(q), env + 1.2);
    addM(h, T, vec3(0.3, 1.0, 0.25) * 1.3);
    h.fill = T < 0.0 ? 0.12 + 0.1 * step(1.5, uComp) : 0.03 + 0.06 * step(0.5, uComp) * step(uComp, 1.5);
    h.fcol = T < 0.0 ? vec3(0.25, 1.0, 0.2) : vec3(0.6, 0.9, 0.3);
    // starch and DNA in the stroma
    float st = sdEll(q - vec3(10.0, -3.2, 3.0), vec3(3.0, 1.6, 2.2));
    addM(h, st, vec3(0.95, 0.95, 0.85));
    if (st < 0.0) { h.fill = 0.12; h.fcol = vec3(1.0, 1.0, 0.9); }
    vec3 r = q - vec3(-6.0, -3.0, -6.0);
    addM(h, length(vec2(length(r.xz) - 0.6, r.y)) - 0.05, vec3(1.0, 0.95, 0.4) * (1.0 + 2.5 * uHiDNA));
  }
}

/* ---------- plastids ---------- */
void plastids(vec3 p, inout Hit h){
  vec3 q = p - vec3(${ORG_X.plastid}.0, 0.0, 0.0);
  // amyloplast: starch grains fill it
  vec3 a = q + vec3(14.0, 0.0, 0.0);
  float ea = sdEll(a, vec3(11.0, 8.0, 8.0));
  addM(h, ea, vec3(0.85, 0.9, 1.0));
  addM(h, ea + 0.35, vec3(0.85, 0.9, 1.0) * 0.8);
  for (int k = 0; k < 5; k++) {
    vec3 c = vec3(sin(float(k) * 2.4) * 5.0, cos(float(k) * 1.9) * 3.5, sin(float(k) * 3.3) * 3.0);
    float g = length(a - c) - 2.6 + 0.4 * sin(float(k));
    addM(h, g, vec3(1.0, 1.0, 0.92));
    if (g < 0.0) { h.fill = 0.14; h.fcol = vec3(1.0, 1.0, 0.95); }
  }
  // chromoplast: orange-yellow pigment globules
  vec3 b = q - vec3(14.0, 0.0, 0.0);
  float eb = sdEll(b, vec3(10.0, 7.0, 7.5));
  addM(h, eb, vec3(1.0, 0.65, 0.2));
  addM(h, eb + 0.35, vec3(1.0, 0.65, 0.2) * 0.8);
  vec3 cell = floor(b / 2.0);
  vec3 f = fract(b / 2.0) - 0.5 - (hash33(cell) - 0.5) * 0.5;
  float glob = length(f) * 2.0 - 0.45;
  if (eb < -1.0) { addM(h, glob, vec3(1.0, 0.55, 0.12)); if (glob < 0.0) { h.fill = 0.15; h.fcol = vec3(1.0, 0.5, 0.1); } }
}

/* ---------- a peroxisome ---------- */
void perox(vec3 p, inout Hit h){
  vec3 q = p - vec3(${ORG_X.perox}.0, 0.0, 0.0);
  float m = length(q) - 4.6;
  addM(h, m, C_PER);
  if (m < 0.0) {
    h.fill = 0.035; h.fcol = vec3(1.0, 0.9, 0.5);
    // the crystalline core: enzyme packed in a lattice
    vec3 r = q - vec3(0.6, -0.3, 0.0);
    r.xy = rot(0.35) * r.xy;
    float box = sdRoundBox(r, vec3(1.7, 1.2, 1.0), 0.1);
    vec3 g = fract(r / 0.3) - 0.5;
    float dots = length(g) * 0.3 - 0.07;
    float core = max(box, dots);
    addM(h, core, vec3(1.0, 0.85, 0.35) * 1.4);
    if (box < 0.0) { h.fill = 0.08; h.fcol = vec3(1.0, 0.8, 0.3); }
  }
}

Hit world(vec3 p){
  Hit h; h.d = 1e9; h.col = vec3(0.0); h.fill = 0.0; h.fcol = vec3(0.0);
  float x = p.x;
  if (x < 150.0) endo(p, h);
  else if (x < 420.0) mito(p, h);
  else if (x < 640.0) network(p, h);
  else if (x < 880.0) chloro(p, h);
  else if (x < 1110.0) plastids(p, h);
  else perox(p, h);
  return h;
}

void main(){
  vec3 ro = uCamPos, rd = rayDir(vUv);
  vec3 acc = vec3(0.0);
  float t = 0.05;
  vec4 sec = vec4(0.0);
  // the section on the cut plane
  if (uCutOn > 0.5 && ro.z > uCutZ && rd.z < 0.0) {
    t = (uCutZ - ro.z) / rd.z;
    vec3 q = ro + rd * t;
    Hit hh = world(q);
    float px = t * 0.0016;
    float line = exp(-sq(hh.d / max(TH * 0.55, px)));
    sec.rgb = hh.col * line * 1.8 + hh.fcol * hh.fill * 3.2;
    sec.a = clamp(line + hh.fill * 3.0, 0.0, 1.0);
    t += 0.01;
  }
  // behind the cut: the membranes glow where a ray passes through them
  for (int i = 0; i < 150; i++) {
    vec3 p = ro + rd * t;
    Hit hh = world(p);
    float d = abs(hh.d);
    float st = clamp(d * 0.6, TH * 0.35, 3.0);
    float fall = exp(-t * 0.006);
    acc += hh.col * exp(-sq(d / TH)) * st * 1.4 * fall;
    acc += hh.fcol * hh.fill * st * 0.25 * fall;
    t += st;
    if (t > 600.0) break;
  }
  // fluorescence saturates: an edge-on membrane is bright, never blinding
  acc = 1.0 - exp(-acc * 0.9);
  vec3 bg = backdrop(rd, 0.5) * 0.8;
  vec3 col = bg + acc;
  col = mix(col, sec.rgb + col * (1.0 - sec.a) * 0.35, sec.a);
  // the ribosomes of the matrix and stroma: fine speckle, on request
  o = vec4(col * uFade, 1.0);
}
`

export class Organelles {
  fs: FullScreen
  constructor() {
    this.fs = new FullScreen(
      sm(FRAG, {
        uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uRes: U.uRes, uTime: U.uTime,
        uEngulf: { value: 0 }, uGen: { value: 0 }, uCrist: { value: 0 }, uEngulf2: { value: 0 }, uThyl: { value: 0 }, uFis: { value: 0 }, uComp: { value: 0 },
        uCutOn: { value: 1 }, uCutZ: { value: 0 }, uFade: { value: 1 }, uHiDNA: { value: 0 }, uHiRibo: { value: 0 }, uDiv: { value: 0 },
      }),
    )
  }
}
