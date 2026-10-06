import * as THREE from 'three'
import { HASH, NOISE, SDF3, RAY } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm } from './post'

/* ==========================================================================
   AN EPITHELIUM — 1 unit = 100 nm. The lining of the small intestine: a
   sheet of columnar cells, 7 µm across and 16 µm tall, packed as hexagons,
   each with a brush border of microvilli on top and a nucleus near its
   base. Neighbouring plasma membranes run 20 nm apart, except:
     tight junctions   a belt just below the top where the membranes are
                       pressed together, sealing the sheet
     desmosomes        plaques, rivets, with keratin filaments fanning
                       into each cell
     gap junctions     patches of protein pores bridging the gap
   Drawn as fluorescent membranes, cut open at z = 0 like Figure 4.28.
   Two dye tests: a dye on top that cannot leak down between the cells;
   a dye injected into one cell that spreads to its neighbours.
   ========================================================================== */

const FRAG = /* glsl */ `
${HASH}${NOISE}${SDF3}${RAY}
uniform float uCutOn, uCutZ, uFade, uDyeTop, uDye, uHi;   // uHi: 0 none, 1 tight, 2 desmosome, 3 gap
const float S = 70.0;          // across the flats
const float TOP = 80.0, BOT = -80.0;
const float TH = 0.16;
float sq(float x){ return x * x; }
float sdHex2(vec2 p, float r){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x) - r; }
vec4 hexCell(vec2 p){
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}

/* the cell interior field around p: negative inside the nearest cell's cytoplasm */
float cellD(vec3 p, out vec2 id, out vec2 lq){
  vec4 h = hexCell(p.xz / S);
  id = h.zw;
  lq = h.xy * S;
  // the gap between neighbours: 20 nm, closed in the tight-junction belt
  float gap = 0.1 * (1.0 - smoothstep(TOP - 9.0, TOP - 7.0, p.y) * (1.0 - smoothstep(TOP - 3.0, TOP - 1.5, p.y)));
  float side = sdHex2(lq, S * 0.5 - gap);
  float d = max(side, max(p.y - TOP, BOT - p.y));
  // microvilli: a brush border on top, 1 µm tall, 100 nm wide
  if (p.y > TOP - 1.0 && p.y < TOP + 11.0) {
    vec2 g = (fract(p.xz / 1.25) - 0.5) * 1.25;
    float mv = max(length(g) - 0.45, max(p.y - TOP - 10.0 + 0.4 * sin(p.x * 0.7 + p.z * 0.5), TOP - 1.0 - p.y));
    mv = max(mv, side + 0.5);
    d = min(d, mv);
  }
  return d;
}
float nucleusD(vec3 p, vec2 lq){ return length(vec3(lq.x, p.y + 38.0, lq.y) / vec3(13.0, 22.0, 13.0)) * 13.0 - 13.0; }

/* the junctions on a lateral face: where they sit, and how they look */
void junctions(vec3 p, vec2 lq, float side, inout vec3 e, float st){
  float edge = exp(-sq(side / 0.6));                         // near a lateral membrane
  // tight-junction strands: a belt of ridges just below the top
  float tj = smoothstep(TOP - 9.5, TOP - 8.0, p.y) * (1.0 - smoothstep(TOP - 2.0, TOP - 1.0, p.y));
  float strands = 0.5 + 0.5 * sin(p.y * 6.0 + sin(atan(lq.y, lq.x) * 9.0) * 2.0);
  e += vec3(0.6, 1.0, 1.0) * tj * edge * (0.6 + 0.8 * strands) * st * (1.0 + 3.5 * float(uHi == 1.0));
  // desmosomes: plaques (≈ 0.5 µm) at two heights, keratin bundles fanning inward
  for (int k = 0; k < 2; k++) {
    float y0 = k == 0 ? 52.0 : 12.0;
    float a = atan(lq.y, lq.x);
    float sec = fract(a / 6.2832 * 6.0 + 0.5 + float(k) * 0.08) - 0.5;   // near each face's centre
    float plaque = exp(-sq((p.y - y0) / 2.5)) * exp(-sq(sec / 0.06)) * edge;
    e += vec3(0.9, 0.7, 1.0) * plaque * st * 2.4 * (1.0 + 2.0 * float(uHi == 2.0));
    // keratin filaments: lines from the plaque into the cytoplasm
    // bundles leave the plaque and splay into the cytoplasm, each gently curved
    float into = -side;
    float dy = p.y - y0;
    float r = length(vec2(into, dy));
    float th = atan(dy, into + 0.8);
    float ray = 0.5 + 0.5 * cos(th * 14.0 + 0.35 * sin(r * 0.22 + float(k) * 2.0) + sec * 9.0);
    ray *= ray; ray *= ray; ray *= ray;                     // thin lines
    float fan = ray * step(0.0, into) * step(abs(th), 1.15) * smoothstep(18.0, 4.0, r) * exp(-sq(sec / 0.14));
    e += vec3(0.7, 0.45, 1.0) * fan * st * 0.7 * (1.0 + float(uHi == 2.0));
  }
  // gap junctions: patches of pores bridging the gap
  for (int k = 0; k < 2; k++) {
    float y0 = k == 0 ? 32.0 : -14.0;
    float a = atan(lq.y, lq.x);
    float sec = fract(a / 6.2832 * 6.0 + 0.5 + 0.06 + float(k) * 0.05) - 0.5;   // just behind the cut
    float gpatch = exp(-sq((p.y - y0) / 3.0)) * exp(-sq(sec / 0.09));
    float dots = smoothstep(0.35, 0.1, length(fract(vec2(p.y, sec * 60.0) * 0.8) - 0.5));
    e += vec3(1.0, 0.9, 0.4) * gpatch * exp(-sq(side / 0.35)) * (0.4 + dots) * st * 2.2 * (1.0 + 2.0 * float(uHi == 3.0));
  }
}

void main(){
  vec3 ro = uCamPos, rd = rayDir(vUv);
  vec3 acc = vec3(0.0);
  float t = 0.05;
  vec4 sec = vec4(0.0);
  if (uCutOn > 0.5 && ro.z > uCutZ && rd.z < 0.0) {
    t = (uCutZ - ro.z) / rd.z;
    vec3 q = ro + rd * t;
    vec2 id, lq;
    float d = cellD(q, id, lq);
    float px = t * 0.0016;
    float line = exp(-sq(d / max(TH * 0.6, px)));
    vec3 c = vec3(0.45, 0.9, 1.0) * line * 1.6;
    float inside = smoothstep(0.2, -0.2, d);
    c += vec3(0.02, 0.035, 0.05) * inside;
    float nd = nucleusD(q, lq);
    c += vec3(0.3, 0.45, 1.0) * (exp(-sq(nd / max(0.3, px))) * 1.2 + smoothstep(0.3, -0.3, nd) * 0.12) * inside;
    // the injected dye, spreading cell to cell through gap junctions
    float dist = length(id * vec2(1.0, 1.7320508));
    float lvl = clamp(uDye * 3.2 - dist * 1.0, 0.0, 1.0);
    c += vec3(1.0, 0.85, 0.25) * lvl * 0.35 * inside;
    // the dye poured on top
    float above = smoothstep(TOP + 0.5, TOP + 1.5, q.y) * (1.0 - smoothstep(TOP + 14.0, TOP + 30.0, q.y)) * step(0.0, d) * uDyeTop;
    c += vec3(0.3, 1.0, 0.5) * above * 0.5;
    vec3 e = vec3(0.0);
    junctions(q, lq, sdHex2(lq, S * 0.5), e, 1.0);
    c += e * 0.8;
    sec = vec4(c, clamp(line + inside * 0.45 + above * 0.5, 0.0, 1.0));
    t += 0.01;
  }
  for (int i = 0; i < 140; i++) {
    vec3 p = ro + rd * t;
    vec2 id, lq;
    float d = cellD(p, id, lq);
    float ad = abs(d);
    float st = clamp(ad * 0.6, TH * 0.4, 4.0);
    // fade with distance, and with depth behind the cut, so the cutaway reads as one layer of cells
    float fall = exp(-t * 0.0028) * exp(-max(0.0, uCutZ - p.z) * 0.03 * uCutOn);
    acc += vec3(0.45, 0.9, 1.0) * exp(-sq(ad / TH)) * st * 0.9 * fall * (p.y > TOP ? 0.35 : 1.0);   // the brush border is dense: dim it
    if (d < 0.0) {
      float nd = nucleusD(p, lq);
      acc += vec3(0.3, 0.45, 1.0) * exp(-sq(nd / 0.5)) * st * 0.6 * fall;
      float dist = length(id * vec2(1.0, 1.7320508));
      float lvl = clamp(uDye * 3.2 - dist, 0.0, 1.0);
      acc += vec3(1.0, 0.85, 0.25) * lvl * st * 0.004 * fall;
      vec3 e = vec3(0.0);
      junctions(p, lq, sdHex2(lq, S * 0.5), e, st * 0.4);
      acc += e * fall;
    } else if (p.y > TOP) {
      acc += vec3(0.3, 1.0, 0.5) * uDyeTop * st * 0.0025 * fall;
    }
    t += st;
    if (t > 900.0) break;
  }
  acc = 1.0 - exp(-acc * 0.9);
  vec3 bg = backdrop(rd, 0.4) * 0.7;
  vec3 col = bg + acc;
  col = mix(col, sec.rgb + col * (1.0 - sec.a) * 0.3, sec.a);
  o = vec4(col * uFade, 1.0);
}
`

export class Epithelium {
  fs: FullScreen
  constructor() {
    this.fs = new FullScreen(
      sm(FRAG, {
        uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uRes: U.uRes, uTime: U.uTime,
        uCutOn: { value: 1 }, uCutZ: { value: 0 }, uFade: { value: 1 }, uDyeTop: { value: 0 }, uDye: { value: 0 }, uHi: { value: 0 },
      }),
    )
  }
}
