import * as THREE from 'three'
import { HASH, NOISE, SDF3, RAY } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm } from './post'

/* ==========================================================================
   INSIDE — one continuous world, 1 unit = 10 nm, raymarched.
   The membranes of the endomembrane system are drawn as the boundary of
   one set of compartments, the lumens, because that is what they are:
     the perinuclear space, between the two membranes of the nuclear
       envelope, joined through short necks to
     the rough ER, three stacked sheets with fenestrae, joined to
     the smooth ER, a tubular net that can proliferate;
     the Golgi, six cisternae that mature from cis to trans;
     lysosomes; and the outside of the cell, beyond the plasma membrane,
       which is topologically the same side as every lumen.
   Each membrane is a 7-nm bilayer around the zero set of that lumen field.
   Nuclear pores are holes in the envelope's lumen, so at the lip of each
   pore the inner and outer membranes run into one another, as they do.
   Translucent membranes are accumulated front to back; solid things (pore
   complexes, the nucleolus, a bacterium, a damaged mitochondrion) are hit
   and shaded. Raster meshes (ribosomes, chromatin, vesicles, ions) are
   drawn first; this pass reads their colour and depth and lays the
   membranes over them.
   ========================================================================== */

export const NCx = -520
export const RI = 500
export const RO = 503
export const RER_R = [525, 545, 565]
export const GOLGI_C = new THREE.Vector3(125, -5, 0)
export const PM_X = 330
export const LYSO = [new THREE.Vector3(215, 55, -30), new THREE.Vector3(240, -70, 25), new THREE.Vector3(205, -20, 60)]
export const AUTO_M = new THREE.Vector3(262, 92, -18)
export const PHAGO_P = new THREE.Vector3(PM_X, -38, 0)
export const EXO_P = new THREE.Vector3(PM_X, 62, 28)
export const NUCLEOLUS = new THREE.Vector3(-150, 55, 30)

const FRAG = /* glsl */ `
${HASH}${NOISE}${SDF3}${RAY}
uniform sampler2D uMeshCol, uMeshDepth;
uniform float uNear, uFar;
uniform vec3 uFwd;
uniform float uVesK, uSer, uGolgiPh, uCutOn, uCutZ, uBudR, uBudK, uVesR, uPhago, uLysoFuse, uDigest, uAuto, uAutoFuse, uStore, uExo, uCa, uFade, uFocus, uNPC, uLumen;
uniform vec3 uBud, uVes;

const vec3 NC = vec3(${NCx}.0, 0.0, 0.0);
const float RM = 501.5;
const vec3 G = vec3(${GOLGI_C.x.toFixed(1)}, ${GOLGI_C.y.toFixed(1)}, ${GOLGI_C.z.toFixed(1)});
const float PMX = ${PM_X}.0;
const vec3 LY0 = vec3(${LYSO[0].x.toFixed(1)}, ${LYSO[0].y.toFixed(1)}, ${LYSO[0].z.toFixed(1)});
const vec3 LY1 = vec3(${LYSO[1].x.toFixed(1)}, ${LYSO[1].y.toFixed(1)}, ${LYSO[1].z.toFixed(1)});
const vec3 LY2 = vec3(${LYSO[2].x.toFixed(1)}, ${LYSO[2].y.toFixed(1)}, ${LYSO[2].z.toFixed(1)});
const vec3 AM = vec3(${AUTO_M.x.toFixed(1)}, ${AUTO_M.y.toFixed(1)}, ${AUTO_M.z.toFixed(1)});
const vec3 PH = vec3(${PHAGO_P.x.toFixed(1)}, ${PHAGO_P.y.toFixed(1)}, ${PHAGO_P.z.toFixed(1)});
const vec3 EX = vec3(${EXO_P.x.toFixed(1)}, ${EXO_P.y.toFixed(1)}, ${EXO_P.z.toFixed(1)});
const vec3 NL = vec3(${NUCLEOLUS.x.toFixed(1)}, ${NUCLEOLUS.y.toFixed(1)}, ${NUCLEOLUS.z.toFixed(1)});
const float TH = 0.35;   // half a bilayer, 3.5 nm
/* cheap smooth wobble (the raymarch evaluates these hundreds of times per pixel) */
float sn2(vec2 p){ return sin(p.x * 1.7 + sin(p.y * 1.3)) * sin(p.y * 1.1 + sin(p.x * 1.9)); }
float sn3(vec3 p){ return sin(p.x * 1.7 + sin(p.y * 1.3 + p.z * 0.7)) * sin(p.y * 1.1 + sin(p.z * 1.9)) * sin(p.z * 1.3 + sin(p.x * 0.9)); }

/* membrane identities, for colour */
const int M_ENV = 1, M_RER = 2, M_SER = 3, M_GOL = 4, M_LYS = 5, M_PM = 6, M_VES = 7, M_AUTO = 8;

/* tangent coordinates on the nucleus, around the +x pole (units of length at the envelope) */
vec2 tanUV(vec3 p){ vec3 q = p - NC; return vec2(atan(q.y, q.x), atan(q.z, q.x)) * RM; }

/* the nearest nuclear pore: a jittered staggered lattice 300 nm apart, one pore exactly on the axis */
vec2 poreNear(vec2 uv){
  const float S = 30.0;
  vec2 g = uv / S;
  vec2 i0 = floor(g);
  vec2 best = vec2(0.0);
  float bd = length(uv);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = i0 + vec2(float(i), float(j));
    vec2 h = hash22(c + 11.0) - 0.5;
    vec2 pc = (c + 0.5 + vec2(mod(c.y, 2.0) * 0.5, 0.0) + h * 0.3) * S;
    if (length(pc) < 20.0) continue;
    float d = length(uv - pc);
    if (d < bd) { bd = d; best = pc; }
  }
  return best;
}

/* ---- the nuclear envelope: a 30-nm lumen between two membranes, holed by pores ---- */
float envL(vec3 p, out float dax, out vec2 pc){
  vec3 q = p - NC;
  float r = length(q);
  float shell = abs(r - RM) - 1.5;
  vec2 uv = tanUV(p);
  pc = poreNear(uv);
  dax = length(uv - pc);
  return smax(shell, 5.2 - dax, 1.4);
}

/* ---- rough ER: three sheets, fenestrated, ragged at the edges, joined by necks ---- */
float rerL(vec3 p, vec2 uv, float r){
  float L = 1e9;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float Rk = 525.0 + 20.0 * fk;
    float sh = abs(r - Rk - 1.6 * sin(uv.x * 0.031 + fk) * sin(uv.y * 0.026 - fk)) - 2.2;
    float edge = length((uv - vec2(-175.0, 0.0)) / vec2(150.0 - fk * 8.0, 210.0 - fk * 12.0)) - 1.0 + 0.1 * sn2(uv * 0.021 + fk * 3.0);
    sh = smax(sh, edge * 90.0, 2.0);
    vec2 fh = uv / 19.0 + fk * 7.3;
    vec2 fi = floor(fh);
    vec2 ff = fract(fh) - 0.5 - (hash22(fi) - 0.5) * 0.45;
    float hole = hash12(fi + fk * 3.1) < 0.3 ? length(ff) * 19.0 - 3.2 : 1e3;
    sh = smax(sh, -hole, 1.2);
    // a gap in the middle sheets where the Golgi-bound traffic leaves the outermost one
    L = min(L, sh);
  }
  // necks: short tubes joining the envelope's outer membrane and the sheets
  vec2 ng = uv / 46.0;
  vec2 ni = floor(ng);
  vec2 nc = (ni + 0.5 + (hash22(ni + 3.0) - 0.5) * 0.5) * 46.0;
  float neck = max(length(uv - nc) - 2.6, abs(r - 534.0) - 32.0);
  if (hash12(ni + 9.0) < 0.6 && length((nc - vec2(-175.0, 0.0)) / vec2(140.0, 200.0)) < 0.92) L = smin(L, neck, 2.0);
  return L;
}

/* ---- smooth ER: a warped net of 45-nm tubules, above the rough ER; uSer makes it proliferate ---- */
float serL(vec3 p, float r){
  vec3 w = p + 6.0 * vec3(sn3(p * 0.03), sn3(p.yzx * 0.03 + 5.0), sn3(p.zxy * 0.03 + 9.0));
  vec3 c = mod(w, 24.0) - 12.0;
  float t = min(min(length(c.xy), length(c.yz)), length(c.xz)) - 2.2;
  float reg = max(568.0 - r, r - (598.0 + 40.0 * uSer));
  reg = max(reg, p.y + 70.0 - 25.0 * (uSer - 1.0));
  reg = max(reg, abs(p.z) - 90.0 - 40.0 * (uSer - 1.0));
  reg = max(reg, -p.y - 230.0 - 50.0 * (uSer - 1.0));
  return smax(t, reg, 4.0);
}

/* ---- the Golgi: six cisternae moving cis → trans; m = maturity of the nearest ---- */
float golgiL(vec3 p, out float m){
  vec3 q = p - G;
  float rr = length(q.yz);
  float L = 1e9;
  m = 0.0;
  float ph = fract(uGolgiPh);
  for (int k = 0; k < 6; k++) {
    float s = float(k) + ph;                // slot, 0 = cis, 6 = gone
    float xk = -15.0 + s * 5.4;
    float grow = smoothstep(0.0, 1.0, s);   // a new cis cisterna coalesces from vesicles
    float fade = 1.0 - smoothstep(5.2, 6.0, s);
    float R = (36.0 - s * 1.6) * grow * fade + 0.001;
    float bow = 0.011 * rr * rr;
    float th = 0.9 * (1.0 + 1.2 * smoothstep(R * 0.72, R, rr));
    float d = abs(q.x - xk + bow) - th;
    d = smax(d, rr - R, 2.5);
    // rims break up into tubules and buds, more toward trans
    vec2 a = vec2(atan(q.z, q.y) * 8.0, rr * 0.25);
    float fen = smoothstep(R * 0.6, R, rr) * (0.3 + 0.12 * s);
    d += fen * (sn2(a + s * 3.0) * 0.9 + 0.2);
    if (d < L) { L = d; m = s / 6.0; }
  }
  return L;
}

/* ---- lysosomes, the plasma membrane, phagocytosis, autophagy, exocytosis ---- */
vec3 bactC(){ return PH + vec3(18.0 - 34.0 * smoothstep(0.55, 1.0, uPhago) - 40.0 * smoothstep(0.0, 1.0, uLysoFuse), 0.0, 0.0); }
float bactS(vec3 p){ vec3 q = p - bactC(); q.xy = rot(0.3) * q.xy; float s = 1.0 - 0.45 * uDigest; return sdCapsule(q / s, 10.0, 4.4) * s + sn3(q * 0.4) * 0.25; }
float outerL(vec3 p, out int id){
  // the outside of the cell counts as lumen: negative where x > PMX
  id = M_PM;
  float L = PMX - p.x;
  if (uPhago > 0.001) {
    // phagocytosis: pseudopods (cytoplasm) rise round the bacterium, then close into a food vacuole
    float w = smoothstep(0.0, 0.55, uPhago);
    float db = bactS(p);
    float pod = abs(db - 2.6) - 1.7;
    pod = smax(pod, (p.x - PMX) - mix(-6.0, 26.0, w), 1.5);
    float C = p.x - PMX;                 // cytoplasm, negative inside
    C = smin(C, pod, 2.0);
    C = smax(C, -(db - 1.2), 0.8);       // a thin gap of outside stays round the prey
    float O1 = -C;
    float O2 = min(PMX - p.x, db - 2.0);  // pinched off: a food vacuole, inside
    L = mix(O1, O2, smoothstep(0.55, 0.75, uPhago));
  }
  // exocytosis: a secretory vesicle fuses and opens
  vec3 vc = EX - vec3(mix(10.0, 1.0, smoothstep(0.0, 0.7, uExo)), 0.0, 0.0);
  float dv = length(p - vc) - 4.0;
  L = smin(L, dv, mix(0.01, 3.0, smoothstep(0.55, 0.85, uExo)));
  if (uExo < 0.55) L = min(L, dv);
  // lysosomes (one swells with what it can't digest)
  float l0 = length(p - LY0) - 15.0 * (1.0 + 0.9 * uStore);
  vec3 bc = bactC();
  float dbb = bactS(p);
  vec3 ly1 = mix(LY1, bc + vec3(-6.0, -12.0, 4.0), smoothstep(0.0, 1.0, uLysoFuse));
  float l1 = length(p - ly1) - 12.0;
  if (uLysoFuse > 0.6) l1 = smin(l1, dbb - 2.0, 4.0 * smoothstep(0.6, 1.0, uLysoFuse));
  vec3 ly2 = mix(LY2, AM + vec3(-18.0, -10.0, 10.0), smoothstep(0.0, 1.0, uAutoFuse));
  float l2 = length(p - ly2) - 11.0;
  float ll = min(l0, min(l1, l2));
  if (ll < L) { L = ll; id = M_LYS; }
  // autophagy: a cup of double membrane closes round a damaged mitochondrion
  vec3 q = p - AM;
  float th = mix(0.6, 3.1416, smoothstep(0.0, 1.0, uAuto));
  float ang = acos(clamp(dot(normalize(q + 1e-4), vec3(0.0, 1.0, 0.0)), -1.0, 1.0));
  float cap = max(abs(length(q) - 26.0) - 1.3, ang - th);
  cap = smin(cap, length(p - ly2) - 11.0, 4.0 * smoothstep(0.55, 1.0, uAutoFuse));
  if (uAuto > 0.01 && cap < L) { L = cap; id = M_AUTO; }
  return L;
}

/* ---- solids: pore complexes, nucleolus, bacterium, the damaged mitochondrion ---- */
float npc(float dax, vec2 d2, float r){
  // an eight-fold ring at the lip, filaments out into the cytoplasm, a basket on the nuclear side
  float an = atan(d2.y, d2.x);
  float sector = (fract(an / 6.2832 * 8.0) - 0.5) / 8.0 * 6.2832;
  vec2 lp = vec2(cos(sector), sin(sector)) * dax;
  float h = r - RM;
  float ring = length(vec3(lp.x - 6.2, h, lp.y * 1.2)) - 1.7;
  float rings = min(length(vec2(dax - 5.6, h - 1.6)) - 0.9, length(vec2(dax - 5.6, h + 1.6)) - 0.9);
  float spokes = max(abs(lp.y) - 0.7, max(abs(h) - 1.4, abs(dax - 4.3) - 1.6));
  float fil = max(length(vec2(lp.y, dax - 4.6 + 0.12 * (h - 3.0) * (h - 3.0) * 0.0)) - 0.45, abs(h - 5.5) - 3.5);
  float bas = max(length(vec2(lp.y, dax - mix(5.0, 2.0, clamp((-h - 2.0) / 7.0, 0.0, 1.0)))) - 0.4, abs(h + 5.5) - 3.5);
  float br = length(vec2(dax - 2.0, h + 9.0)) - 0.6;
  return min(min(min(ring, rings), spokes), min(min(fil, bas), br));
}
float nucleolusS(vec3 p){
  vec3 q = p - NL;
  return length(q / vec3(1.0, 0.85, 0.95)) - 38.0 + 3.0 * sn3(q * 0.08) + 1.2 * sn3(q * 0.21 + 3.0);
}
float mitoS(vec3 p){
  vec3 q = p - AM;
  q.xz = rot(0.4) * q.xz;
  float s = 1.0 - 0.5 * smoothstep(0.7, 1.0, uAutoFuse);
  return sdCapsule(q / s, 14.0, 9.0) * s;
}
/* ---- the whole world in one pass: lumen field L (membranes at its zero set) and solids S ---- */
float scene(vec3 p, out int id, out float m, out float S, out int sid){
  id = 0; m = 0.0; S = 1e9; sid = 0;
  float L = 1e9;
  if (p.x < 75.0) {
    vec3 q = p - NC;
    float r = length(q);
    vec2 uv = tanUV(p);
    vec2 pc = poreNear(uv);
    vec2 d2 = uv - pc;
    float dax = length(d2);
    float shell = abs(r - RM) - 1.5;
    L = smax(shell, 5.2 - dax, 1.4);
    id = M_ENV;
    float h = abs(r - RM);
    if (uNPC > 0.0 && h < 13.0) {
      if (dax < 9.0) { S = npc(dax, d2, r); sid = 1; }
      else S = dax - 8.5;
    } else S = max(h - 12.0, 0.4);
    if (r > 503.0 && r < 645.0 + 60.0 * uSer) {
      float re = rerL(p, uv, r);
      float er = re;
      if (r > 560.0) {
        float se = serL(p, r);
        er = smin(re, se, 3.0);
        if (er < L && se < re) id = M_SER;
      }
      if (er < L && id != M_SER) id = M_RER;
      L = smin(L, er, 1.5);
    }
    if (uBudR > 0.01) {
      float b = length(p - uBud) - uBudR;
      if (uBudK > 0.05) { L = smin(L, b, uBudK); if (b < 1.0) id = M_VES; }
      else if (b < L) { L = b; id = M_VES; }
    }
    // the nuclear lamina: a net of 10-nm filaments just inside the inner membrane (not across the pores)
    if (r > 493.0 && r < 500.5) {
      vec2 g1 = uv;
      vec2 g2 = mat2(0.5, 0.866, -0.866, 0.5) * uv;
      vec2 g3 = mat2(0.5, -0.866, 0.866, 0.5) * uv;
      float l = min(min(abs(fract(g1.x / 9.0) - 0.5) * 9.0, abs(fract(g2.x / 9.0) - 0.5) * 9.0), abs(fract(g3.x / 9.0) - 0.5) * 9.0);
      float lam = length(vec2(l, r - 497.6)) - 0.5;
      lam = max(lam, 7.0 - dax);
      if (lam < S) { S = lam; sid = 5; }
    }
    if (p.x < -60.0) { float n = nucleolusS(p); if (n < S) { S = n; sid = 2; } }
  } else if (p.x < 185.0) {
    float mm;
    L = golgiL(p, mm);
    id = M_GOL; m = mm;
  } else {
    int oid;
    L = outerL(p, oid);
    id = oid;
    if (uPhago > 0.001 && uDigest < 0.99) { float b = bactS(p); if (b < S) { S = b; sid = 3; } }
    if (uAuto > 0.001) { float mt = mitoS(p); if (mt < S) { S = mt; sid = 4; } }
  }
  if (uVesR > 0.01) {
    float v = length(p - uVes) - uVesR;
    if (uVesK > 0.02) { float nl = smin(L, v, uVesK); if (v < L) id = M_VES; L = nl; }
    else if (v < L) { L = v; id = M_VES; }
  }
  return L;
}
float lumen(vec3 p, out int id, out float m){ float S; int s; return scene(p, id, m, S, s); }
float solids(vec3 p, out int sid){ int id; float m, S; scene(p, id, m, S, sid); return S; }

vec3 memCol(int id, float m){
  if (id == M_ENV) return vec3(0.3, 0.5, 1.0);
  if (id == M_RER) return vec3(0.25, 1.0, 0.45);
  if (id == M_SER) return vec3(0.45, 0.95, 0.75);
  if (id == M_GOL) return mix(vec3(0.3, 0.9, 0.85), vec3(1.0, 0.62, 0.18), smoothstep(0.1, 0.85, m));
  if (id == M_LYS) return vec3(1.0, 0.32, 0.22);
  if (id == M_PM) return vec3(0.55, 0.95, 1.0);
  if (id == M_AUTO) return vec3(0.9, 0.7, 1.0);
  return vec3(1.0, 0.92, 0.65);
}
vec3 lumenTint(int id, float m){
  if (id == M_ENV || id == M_RER) return vec3(0.02, 0.06, 0.03);
  if (id == M_SER) return vec3(0.02, 0.05, 0.045) * (1.0 + 4.0 * uCa);
  if (id == M_GOL) return mix(vec3(0.01, 0.05, 0.05), vec3(0.06, 0.035, 0.01), m);
  if (id == M_LYS) return vec3(0.07, 0.012, 0.008);
  if (id == M_PM) return vec3(0.0);
  return vec3(0.03, 0.03, 0.02);
}

vec3 gradL(vec3 p, float L0){
  int i; float m;
  const float e = 0.08;
  return normalize(vec3(lumen(p + vec3(e, 0.0, 0.0), i, m) - L0, lumen(p + vec3(0.0, e, 0.0), i, m) - L0, lumen(p + vec3(0.0, 0.0, e), i, m) - L0) + 1e-6);
}
vec3 gradS(vec3 p){
  int i;
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.05;
  return normalize(k.xyy * solids(p + k.xyy * e, i) + k.yyx * solids(p + k.yyx * e, i) + k.yxy * solids(p + k.yxy * e, i) + k.xxx * solids(p + k.xxx * e, i));
}

/* the crowded cytosol, far out of focus */
vec3 cytosolBg(vec3 rd){
  vec3 c = mix(vec3(0.004, 0.006, 0.011), vec3(0.012, 0.018, 0.03), smoothstep(-0.7, 0.9, rd.y));
  vec2 p = rd.xy / (1.25 - rd.z * 0.25);
  for (int i = 0; i < 16; i++) {
    vec3 h = hash33(vec3(float(i), 13.0, 5.0));
    vec2 ctr = (h.xy - 0.5) * vec2(2.8, 1.8) + vec2(sin(uTime * 0.02 + h.z * 6.0), cos(uTime * 0.015 + h.x * 5.0)) * 0.04;
    float R = mix(0.02, 0.12, h.z * h.z);
    float d = length(p - ctr);
    c += mix(vec3(0.3, 0.6, 1.0), vec3(0.4, 1.0, 0.6), h.x) * smoothstep(R, R * 0.7, d) * 0.012 * (0.4 + h.y);
  }
  return c;
}

float linDepth(float z){ float ndc = z * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear)); }

void main(){
  vec3 ro = uCamPos, rd = rayDir(vUv);
  // what the raster pass drew, and how far away
  vec4 mc = texture(uMeshCol, vUv);
  float md = texture(uMeshDepth, vUv).r;
  float tMesh = md < 0.9999 ? linDepth(md) / max(dot(rd, uFwd), 1e-3) : 1e9;
  float tMax = min(tMesh, 1400.0);
  vec3 acc = vec3(0.0);
  float A = 0.0;
  float t = 0.05;
  // the section: everything nearer than the cut plane is removed
  vec3 sec = vec3(0.0);
  float secA = 0.0;
  if (uCutOn > 0.5 && ro.z > uCutZ && rd.z < 0.0) {
    float tc = (uCutZ - ro.z) / rd.z;
    if (tc < tMax) {
      vec3 q = ro + rd * tc;
      int id; float m;
      float L = lumen(q, id, m);
      float px = tc * 0.0018;
      float lines = exp(-pow2((abs(L) - TH * 0.6) / max(TH * 0.5, px)));
      vec3 mcol = memCol(id, m);
      sec = mcol * lines * 1.6 + lumenTint(id, m) * smoothstep(0.2, -0.4, L) * 6.0;
      secA = clamp(lines * 0.8 + smoothstep(0.2, -0.4, L) * 0.5, 0.0, 0.9);
      t = tc + 0.01;
    } else t = tMax;
  }
  acc = sec; A = secA;
  int crossings = 0;
  bool solidHit = false;
  int sid = 0;
  vec3 hitP = vec3(0.0);
  for (int i = 0; i < 170; i++) {
    if (t > tMax || A > 0.97) break;
    vec3 p = ro + rd * t;
    int id; float m; float S; int s;
    float L = scene(p, id, m, S, s);
    if (S < 0.02) { solidHit = true; sid = s; hitP = p; break; }
    float aL = abs(L);
    if (aL < TH) {
      // inside a bilayer: shade it as a film, brightest edge-on
      vec3 n = gradL(p, L);
      float c = abs(dot(n, rd));
      float rim = 1.0 - c;
      float fog = exp(-t * 0.0022);
      vec3 col = memCol(id, m);
      float a = (0.05 + 0.5 * rim * rim) * fog;
      vec3 e = col * (0.2 + 1.9 * rim * rim) + vec3(1.0) * pow(max(dot(reflect(rd, n), normalize(vec3(-0.4, 0.7, 0.5))), 0.0), 24.0) * 0.4;
      // the bilayer's two leaflets, seen close up
      e *= 0.85 + 0.3 * smoothstep(0.3, 0.9, abs(sin(L / TH * 1.57)));
      acc += (1.0 - A) * a * e;
      A += (1.0 - A) * a;
      t += TH * 2.2;
      crossings++;
      if (crossings > 9) break;
      continue;
    }
    // inside a lumen: a faint tint, so each compartment reads as a space
    if (L < 0.0) {
      float st = min(aL, 6.0);
      acc += (1.0 - A) * lumenTint(id, m) * st * 0.022 * uLumen * exp(-t * 0.002);
    }
    float st = min(aL - TH * 0.9, S * 0.9);
    t += max(st, 0.04 + t * 0.0004);
  }
  vec3 bg = cytosolBg(rd);
  vec3 behind = tMesh < 1e8 ? mc.rgb : bg;
  if (solidHit) {
    vec3 n = gradS(hitP);
    vec3 L = normalize(vec3(-0.4, 0.75, 0.55));
    float dif = max(dot(n, L), 0.0) * 0.7 + 0.3;
    float rim = pow2(1.0 - max(dot(n, -rd), 0.0));
    vec3 base = sid == 1 ? vec3(0.78, 0.7, 1.0) : sid == 5 ? vec3(0.62, 0.42, 1.0) : sid == 2 ? vec3(0.35, 0.45, 1.0) : sid == 3 ? mix(vec3(0.3, 1.0, 0.4), vec3(0.6, 0.35, 0.15), uDigest) : vec3(1.0, 0.25, 0.5) * 0.7;
    float gran = sid == 2 ? 0.55 + 0.6 * smoothstep(0.55, 0.75, worley(hitP * 0.4)) : 1.0;
    behind = base * (dif * 0.55 * gran + rim * 1.3) * exp(-t * 0.0015);
    if (sid == 1) behind += vec3(0.6, 0.5, 1.0) * rim * 0.4;
  }
  vec3 col = acc + (1.0 - A) * behind;
  o = vec4(col * uFade, 1.0);
}
`

const PRE = /* glsl */ `float pow2(float x){ return x * x; }\n`

export class Inside {
  fs: FullScreen
  meshRT: THREE.WebGLRenderTarget
  constructor() {
    this.meshRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture: new THREE.DepthTexture(2, 2) })
    this.fs = new FullScreen(
      sm(FRAG.replace('const vec3 NC', PRE + 'const vec3 NC'), {
        uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uRes: U.uRes, uTime: U.uTime, uMeshCol: { value: null }, uMeshDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 4000 }, uFwd: { value: new THREE.Vector3() },
        uSer: { value: 1 }, uGolgiPh: { value: 0 }, uCutOn: { value: 0 }, uCutZ: { value: 0 }, uBud: { value: new THREE.Vector3() }, uBudR: { value: 0 }, uBudK: { value: 0 },
        uVes: { value: new THREE.Vector3() }, uVesR: { value: 0 }, uVesK: { value: 0 }, uPhago: { value: 0 }, uLysoFuse: { value: 0 }, uDigest: { value: 0 }, uAuto: { value: 0 }, uAutoFuse: { value: 0 },
        uStore: { value: 0 }, uExo: { value: 0 }, uCa: { value: 0 }, uFade: { value: 1 }, uFocus: { value: 50 }, uNPC: { value: 1 }, uLumen: { value: 1 },
      }),
    )
  }
  setSize(w: number, h: number) {
    this.meshRT.setSize(w, h)
  }
}
