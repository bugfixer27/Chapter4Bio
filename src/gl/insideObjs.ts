import * as THREE from 'three'
import { U } from './uniforms'
import { HASH, NOISE } from './glsl'
import { molMat, ribosomeParts, V, blob, glob } from './mol'
import { NCx, RER_R, NUCLEOLUS, LYSO } from './inside'

/* ==========================================================================
   THE INSIDE WORLD'S MOLECULES (raster, drawn before the membranes)
     ribosomes   bound on the rough ER's cytosolic faces and on the outer
                 nuclear membrane, in polysome clusters; free in the cytosol
     hero        one ribosome: its subunits find an mRNA, translate it, and
                 either release a protein into the cytosol or dock on the ER
                 and thread the chain into the lumen, where sugars are added
     subunits    ribosomal subunits leaving the nucleolus through the pores
     chromatin   nucleosomes on a string that condense, level by level,
                 into a chromosome (positions computed on the GPU)
     beads       mRNA, polypeptide, sugars, Ca²⁺, lysosomal enzymes, lipid
                 inclusions: one instanced pool
   ========================================================================== */

const NC = new THREE.Vector3(NCx, 0, 0)
const RM = 501.5
/** a point at tangent coordinates (u, v) on the nucleus-centred sphere of radius r */
export function onShell(u: number, v: number, r: number, out = new THREE.Vector3()) {
  out.set(1, Math.tan(u / RM), Math.tan(v / RM)).normalize()
  return out.multiplyScalar(r).add(NC)
}
const rng = (seed: number) => {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** where the hero ribosome docks: the cytosolic face of the first rough-ER sheet */
export const DOCK = onShell(-70, 0, RER_R[0] + 2.2 + 0.35 + 1.05)
export const DOCK_N = DOCK.clone().sub(NC).normalize()
/** where it first meets its mRNA, out in the cytosol */
export const HERO_FREE = new THREE.Vector3(10, 26, 10)
/** the chromatin demonstration, inside the nucleus */
export const CHROMO = new THREE.Vector3(-95, -14, 4)

/* ------------------------------------------------------------- chromatin
   One fibre of nucleosomes. c = 0 beads on a string (spaced 20 nm, running
   far beyond the view), 1 the 30-nm fibre (a solenoid, six per turn), 2
   looped domains on a scaffold, 3 a condensed chromosome: two sister
   chromatids joined at a centromere, ≈ 1.4 µm long. */
const NB = 6000
const CHROM_GLSL = /* glsl */ `
uniform float uC;
uniform vec3 uC0;
const float NB = ${NB}.0;
vec3 pathA(float L){
  // a meandering string: smooth, roughly arc-length parametrised (≈ 1 unit per unit L)
  float u = L;
  return vec3(55.0 * sin(u / 55.0) + 22.0 * sin(u / 23.0 + 1.0) + 9.0 * sin(u / 9.0 + 2.0),
              40.0 * sin(u / 70.0 + 0.5) + 18.0 * cos(u / 29.0) + 7.0 * sin(u / 11.0),
              45.0 * cos(u / 61.0) - 45.0 + 15.0 * sin(u / 19.0 + 3.0) + 6.0 * cos(u / 7.0));
}
vec3 frameT(vec3 a, vec3 b){ return normalize(b - a + 1e-4); }
vec3 solenoid(float i, vec3 t){
  vec3 n = normalize(cross(t, vec3(0.3, 0.9, 0.2)));
  vec3 bn = cross(t, n);
  float ph = i * 1.047;                      // six nucleosomes per turn
  return (n * cos(ph) + bn * sin(ph)) * 1.25;
}
vec3 loopPos(float i, float sisterGap, float armL, float Lr, float wig){
  float per = 120.0;                         // nucleosomes per loop (drawn)
  float k = floor(i / per);
  float t = fract(i / per);
  float K = floor(NB / per);
  float sis = mod(k, 2.0);                   // sister chromatid
  float kk = floor(k / 2.0);
  float v = (kk + 0.5) / (K * 0.5) * 2.0 - 1.0;  // −1 … 1 along the chromatid
  vec3 arm = normalize(vec3((sis * 2.0 - 1.0) * 0.18 * sign(v), sign(v), 0.0));
  vec3 A = arm * abs(v) * armL + vec3((sis * 2.0 - 1.0) * sisterGap, 0.0, 0.0);
  float th = k * 2.39996;
  vec3 axis = normalize(vec3(arm.x, arm.y, 0.0));
  vec3 r1 = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
  vec3 r2 = cross(axis, r1);
  vec3 rad = r1 * cos(th) + r2 * sin(th);
  vec3 side = cross(axis, rad);
  vec3 p = A + rad * Lr * sin(3.14159 * t) + side * wig * sin(6.28318 * t) + axis * (wig * 0.5) * sin(9.42 * t);
  return p;
}
vec3 chromPos(float i){
  float c = uC;
  float st = fract(i * 0.618034) * 0.35;
  vec3 a = pathA(i * 2.1);
  vec3 b;
  {
    // the 30-nm fibre: the string coiled, its axis six times shorter
    float L = i * 2.1 / 6.0;
    vec3 ax = pathA(L) * 0.55;
    vec3 t = frameT(pathA(L - 0.5) * 0.55, pathA(L + 0.5) * 0.55);
    b = ax + solenoid(i, t);
  }
  vec3 cc = loopPos(i, 26.0, 150.0, 55.0, 9.0);
  vec3 d = loopPos(i, 17.0, 66.0, 16.0, 4.0);
  // the fibre still coils inside the loops
  vec3 tl = normalize(loopPos(i + 1.0, 17.0, 66.0, 16.0, 4.0) - d + 1e-4);
  d += solenoid(i, tl) * 0.8;
  cc += solenoid(i, normalize(loopPos(i + 1.0, 26.0, 150.0, 55.0, 9.0) - cc + 1e-4));
  float k1 = smoothstep(0.0, 1.0, clamp(c * 1.3 - st, 0.0, 1.0));
  float k2 = smoothstep(0.0, 1.0, clamp((c - 1.0) * 1.3 - st, 0.0, 1.0));
  float k3 = smoothstep(0.0, 1.0, clamp((c - 2.0) * 1.3 - st, 0.0, 1.0));
  vec3 p = mix(a, b, k1);
  p = mix(p, cc, k2);
  p = mix(p, d, k3);
  return uC0 + p;
}
`

function nucleosomeGeometry() {
  // a histone octamer (a squat cylinder) with 1.65 turns of DNA wrapped round it
  const core = new THREE.CylinderGeometry(0.34, 0.34, 0.5, 14, 1)
  core.rotateX(Math.PI / 2)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * 1.65 * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, (i / 60 - 0.5) * 0.36))
  }
  const dna = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.1, 6, false)
  const g1 = core.toNonIndexed()
  const g2 = dna.toNonIndexed()
  const n1 = g1.attributes.position.count
  const n2 = g2.attributes.position.count
  const pos = new Float32Array((n1 + n2) * 3)
  const nor = new Float32Array((n1 + n2) * 3)
  const part = new Float32Array(n1 + n2)
  pos.set(g1.attributes.position.array as Float32Array, 0)
  pos.set(g2.attributes.position.array as Float32Array, n1 * 3)
  nor.set(g1.attributes.normal.array as Float32Array, 0)
  nor.set(g2.attributes.normal.array as Float32Array, n1 * 3)
  part.fill(1, n1)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1))
  return g
}

function chromatinMesh() {
  const g = nucleosomeGeometry()
  const idx = new Float32Array(NB)
  for (let i = 0; i < NB; i++) idx[i] = i
  g.setAttribute('aI', new THREE.InstancedBufferAttribute(idx, 1))
  g.instanceCount = NB
  const shared = { uC: { value: 0 }, uC0: { value: CHROMO.clone() }, uTime: U.uTime, uFade: { value: 1 } }
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    vertexShader: /* glsl */ `
      ${CHROM_GLSL}
      in float aI; in float aPart;
      out vec3 vN; out vec3 vV; out float vPart; out float vI;
      void main(){
        vec3 c = chromPos(aI);
        vec3 t = normalize(chromPos(aI + 1.0) - chromPos(aI - 1.0) + 1e-4);
        vec3 n = normalize(cross(t, vec3(0.2, 1.0, 0.3)));
        vec3 b = cross(t, n);
        mat3 R = mat3(n, b, t);
        vec3 p = c + R * position;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vN = normalize(mat3(viewMatrix) * (R * normal));
        vV = mv.xyz;
        vPart = aPart;
        vI = aI;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      uniform float uFade;
      in vec3 vN; in vec3 vV; in float vPart; in float vI;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(-vV);
        if (!gl_FrontFacing) n = -n;
        float dif = max(dot(n, normalize(vec3(-0.4, 0.8, 0.6))), 0.0) * 0.6 + 0.4;
        float rim = 1.0 - max(dot(n, v), 0.0); rim *= rim;
        vec3 base = vPart > 0.5 ? vec3(0.4, 0.62, 1.0) : vec3(0.82, 0.55, 1.0);
        vec3 c = base * (0.25 + 0.55 * dif) + base * rim * 1.3;
        c *= exp(-max(0.0, length(vV) - 30.0) * 0.004) * uFade;
        o = vec4(c, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  // the linker DNA between consecutive nucleosomes
  const cyl = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true)
  const lg = new THREE.InstancedBufferGeometry()
  lg.index = cyl.index
  lg.setAttribute('position', cyl.attributes.position)
  lg.setAttribute('normal', cyl.attributes.normal)
  lg.setAttribute('aI', new THREE.InstancedBufferAttribute(idx, 1))
  lg.instanceCount = NB - 1
  const lmat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: shared,
    vertexShader: /* glsl */ `
      ${CHROM_GLSL}
      in float aI;
      out vec3 vN; out vec3 vV;
      void main(){
        vec3 a = chromPos(aI);
        vec3 b = chromPos(aI + 1.0);
        vec3 d = b - a;
        float L = length(d);
        vec3 y = d / max(L, 1e-4);
        vec3 x = normalize(cross(y, vec3(0.3, 0.2, 1.0)));
        vec3 z = cross(x, y);
        vec3 p = (a + b) * 0.5 + mat3(x, y, z) * (position * vec3(1.0, L, 1.0));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vN = normalize(mat3(viewMatrix) * (mat3(x, y, z) * normal));
        vV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      uniform float uFade;
      in vec3 vN; in vec3 vV;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(-vV);
        float rim = 1.0 - abs(dot(n, v));
        vec3 c = vec3(0.4, 0.62, 1.0) * (0.35 + 1.2 * rim * rim);
        c *= exp(-max(0.0, length(vV) - 30.0) * 0.004) * uFade;
        o = vec4(c, 1.0);
      }`,
  })
  const links = new THREE.Mesh(lg, lmat)
  links.frustumCulled = false
  return { mesh, links, uniforms: shared }
}

export class InsideObjects {
  scene = new THREE.Scene()
  chrom = chromatinMesh()
  ribL: THREE.InstancedMesh
  ribS: THREE.InstancedMesh
  heroL: THREE.Mesh
  heroS: THREE.Mesh
  subL: THREE.InstancedMesh
  subS: THREE.InstancedMesh
  beads: THREE.InstancedMesh
  translocon: THREE.Mesh
  globule: THREE.Mesh
  nBound = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3(1, 1, 1)
  private c = new THREE.Color()
  private beadN = 0

  constructor() {
    const { large, small } = ribosomeParts()
    const lowL = blob([...glob(V(0, 0.42, 0), 1.25, 12, 7, V(1, 0.75, 1))], 20)
    const lowS = blob([...glob(V(0, -0.62, 0), 0.95, 10, 21, V(1.15, 0.55, 0.85))], 20)
    const ribColL = new THREE.Color('#ffd27a').convertSRGBToLinear()
    const ribColS = new THREE.Color('#fff3d6').convertSRGBToLinear()
    const MAX = 2200
    this.ribL = new THREE.InstancedMesh(lowL, molMat(ribColL, { grain: 3 }), MAX)
    this.ribS = new THREE.InstancedMesh(lowS, molMat(ribColS, { grain: 3 }), MAX)
    this.heroL = new THREE.Mesh(large, molMat(ribColL, { grain: 3 }))
    this.heroS = new THREE.Mesh(small, molMat(ribColS, { grain: 3 }))
    this.subL = new THREE.InstancedMesh(large, molMat(ribColL, { grain: 3 }), 40)
    this.subS = new THREE.InstancedMesh(small, molMat(ribColS, { grain: 3 }), 40)
    this.beads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), molMat(new THREE.Color(1, 1, 1), { grain: 1 }), 3000)
    this.beads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3000 * 3), 3)
    // the translocon: a ring of protein in the ER membrane, a channel for the chain
    const tr = blob(Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2
      return [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, 0.42] as [number, number, number, number]
    }).concat(glob(V(0, 0.2, 0), 0.4, 4, 3)), 30)
    this.translocon = new THREE.Mesh(tr, molMat(new THREE.Color('#d6a6ff').convertSRGBToLinear()))
    this.globule = new THREE.Mesh(blob(glob(V(0, 0, 0), 0.9, 14, 77), 34), molMat(new THREE.Color('#ff9b6b').convertSRGBToLinear()))
    for (const o of [this.ribL, this.ribS, this.heroL, this.heroS, this.subL, this.subS, this.beads, this.translocon, this.globule, this.chrom.mesh, this.chrom.links]) {
      o.frustumCulled = false
      this.scene.add(o)
    }
    this.placeRibosomes()
  }

  /* bound ribosomes on every cytosolic face of the rough ER and on the outer nuclear membrane, in polysomes; free ones in the cytosol */
  private placeRibosomes() {
    const r = rng(5)
    let n = 0
    const up = new THREE.Vector3(0, 1, 0)
    const put = (p: THREE.Vector3, toward: THREE.Vector3, spin: number) => {
      this.q.setFromUnitVectors(up, toward)
      const qs = new THREE.Quaternion().setFromAxisAngle(toward, spin)
      this.q.premultiply(qs)
      this.m.compose(p, this.q, this.s)
      this.ribL.setMatrixAt(n, this.m)
      this.ribS.setMatrixAt(n, this.m)
      n++
    }
    const faces: [number, number, number, number, number][] = [] // radius, sign (+1 outer face), ellipse a, b, centre u
    RER_R.forEach((R, k) => {
      faces.push([R + 2.2 + 0.35 + 1.05, 1, 140 - k * 8, 200 - k * 12, -175])
      faces.push([R - 2.2 - 0.35 - 1.05, -1, 140 - k * 8, 200 - k * 12, -175])
    })
    faces.push([503 + 0.35 + 1.05, 1, 300, 300, 0])
    const p = new THREE.Vector3()
    for (const [R, sg, ea, eb, uc] of faces) {
      const clusters = R < 510 ? 60 : 64
      for (let c = 0; c < clusters && n < 1950; c++) {
        let u = 0, v = 0
        do {
          u = (r() * 2 - 1) * ea
          v = (r() * 2 - 1) * eb
        } while ((u / ea) ** 2 + (v / eb) ** 2 > 0.85)
        u += uc
        if (Math.hypot(u, v) < 26 && R < 510) continue // keep the hero pore clear
        if (Math.hypot(u + 70, v) < 9 && Math.abs(R - DOCK.distanceTo(NC)) < 1) continue // and the docking site
        const len = 4 + Math.floor(r() * 6)
        const a0 = r() * Math.PI * 2
        for (let i = 0; i < len; i++) {
          // a polysome: ribosomes strung along one mRNA in a loose spiral
          const a = a0 + i * 0.75
          const uu = u + Math.cos(a) * (1.8 + i * 0.35)
          const vv = v + Math.sin(a) * (1.8 + i * 0.35)
          onShell(uu, vv, R, p)
          const nrm = p.clone().sub(NC).normalize().multiplyScalar(-sg)
          put(p.clone(), nrm, r() * 6.28)
        }
      }
    }
    this.nBound = n
    // free ribosomes and polysomes in the cytosol, between the envelope and the Golgi
    for (let c = 0; c < 26 && n < 2190; c++) {
      const base = new THREE.Vector3(-8 + r() * 80, (r() - 0.5) * 160, (r() - 0.5) * 140)
      const ax = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize()
      const len = 3 + Math.floor(r() * 6)
      for (let i = 0; i < len; i++) {
        const a = i * 0.9
        const pp = base.clone().addScaledVector(ax, i * 1.6).add(new THREE.Vector3(Math.cos(a), Math.sin(a), Math.cos(a * 0.7)).multiplyScalar(1.4))
        put(pp, new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), r() * 6.28)
      }
    }
    this.ribL.count = n
    this.ribS.count = n
    this.ribL.instanceMatrix.needsUpdate = true
    this.ribS.instanceMatrix.needsUpdate = true
  }

  /* ---- the bead pool, refilled every frame ---- */
  private bead(p: THREE.Vector3, r: number, col: THREE.Color | string) {
    if (this.beadN >= 3000) return
    this.s.setScalar(r)
    this.m.compose(p, this.q.identity(), this.s)
    this.beads.setMatrixAt(this.beadN, this.m)
    this.beads.setColorAt(this.beadN, typeof col === 'string' ? this.c.set(col) : col)
    this.beadN++
  }

  /** drive everything from the film; st = the stage values for this set */
  update(st: InsideStage, time: number) {
    this.beadN = 0
    const tmp = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    this.s.set(1, 1, 1)

    /* chromatin */
    const cu = this.chrom.uniforms
    cu.uC.value = st.chromC
    cu.uFade.value = st.chromOn
    this.chrom.mesh.visible = this.chrom.links.visible = st.chromOn > 0.01

    /* bound and free ribosomes */
    this.ribL.visible = this.ribS.visible = st.ribOn > 0.01

    /* the hero ribosome: subunits meet on an mRNA, translate, then (bound) dock */
    const hv = st.hero > 0.01
    this.heroL.visible = this.heroS.visible = hv
    if (hv) {
      const dock = st.dock
      const pos = HERO_FREE.clone().lerp(DOCK, smoothstep(0, 1, dock))
      const nrm = up.clone().lerp(DOCK_N.clone().negate(), smoothstep(0, 1, dock)).normalize()
      this.q.setFromUnitVectors(up, nrm)
      // the small subunit binds the mRNA first; the large joins it
      const join = smoothstep(0.0, 0.25, st.assemble)
      this.heroS.position.copy(pos).addScaledVector(nrm, -(1 - smoothstep(0, 0.12, st.assemble)) * 6)
      this.heroS.quaternion.copy(this.q)
      this.heroL.position.copy(pos).addScaledVector(nrm, (1 - join) * 5).add(new THREE.Vector3(1, 0, 0).multiplyScalar((1 - join) * 4))
      this.heroL.quaternion.copy(this.q)
      // the mRNA threads between the subunits and moves through, one codon at a time
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q)
      const shift = (st.transl * 40) % 1
      for (let i = -14; i <= 14; i++) {
        const x = (i - shift) * 0.42
        const p = pos.clone().addScaledVector(side, x).addScaledVector(nrm, -0.32 + 0.08 * Math.sin(i * 1.7)).add(tmp.set(0, 0, 0.12 * Math.cos(i * 1.3)).applyQuaternion(this.q))
        this.bead(p, 0.15, i % 3 === 0 ? '#ff7a4a' : '#ff9f6a')
      }
      // the polypeptide: grows from the exit tunnel, into the cytosol or through the translocon into the lumen
      const n = Math.floor(st.transl * 46)
      for (let i = 0; i < n; i++) {
        const k = n - i
        let p: THREE.Vector3
        if (dock < 0.5) {
          // free: the chain emerges and folds up beside the ribosome
          const a = k * 0.55
          p = pos.clone().addScaledVector(nrm, 1.5 + Math.min(k, 8) * 0.25).add(tmp.set(Math.cos(a) * (0.3 + k * 0.03), 0, Math.sin(a) * (0.3 + k * 0.03)).applyQuaternion(this.q))
        } else {
          // bound: straight down through the translocon, then it folds in the lumen
          const depth = k * 0.28
          const fold = Math.max(0, depth - 4.0)
          const a = fold * 1.4
          p = pos.clone().addScaledVector(nrm, 1.0 + Math.min(depth, 4.0) + fold * 0.15).add(tmp.set(Math.cos(a) * fold * 0.25, 0, Math.sin(a) * fold * 0.25).applyQuaternion(this.q))
        }
        this.bead(p, 0.17, '#ffd36b')
      }
      // sugars added inside the lumen: a branched tree on the folded chain
      const ns = Math.floor(st.glyco * 11)
      const root = pos.clone().addScaledVector(nrm, 6.2)
      for (let i = 0; i < ns; i++) {
        const br = i < 3 ? i : 3 + ((i - 3) % 4)
        const p = root.clone().addScaledVector(nrm, 0.45 + (i < 3 ? i * 0.4 : 1.2 + Math.floor((i - 3) / 4) * 0.4)).add(tmp.set(i < 3 ? 0 : (br - 4.5) * 0.4, 0, (i % 2) * 0.3).applyQuaternion(this.q))
        this.bead(p, 0.22, i < 2 ? '#8dff7a' : i < 5 ? '#59e1ff' : '#ffe066')
      }
      // the folded cytosolic protein
      this.globule.visible = dock < 0.5 && st.transl > 0.6
      if (this.globule.visible) {
        this.globule.position.copy(pos).addScaledVector(nrm, 2.6)
        this.globule.scale.setScalar(smoothstep(0.6, 1.0, st.transl) * 0.9 + 0.01)
      }
    } else this.globule.visible = false
    this.translocon.visible = st.hero > 0.01 && st.dock > 0.02
    if (this.translocon.visible) {
      this.translocon.position.copy(DOCK).addScaledVector(DOCK_N, -(1.05 + 0.4))
      this.translocon.quaternion.setFromUnitVectors(up, DOCK_N)
    }

    /* ribosomal subunits and mRNA leaving the nucleus */
    const sv = st.export > 0.01
    this.subL.visible = this.subS.visible = sv
    if (sv) {
      let a = 0, b = 0
      for (let i = 0; i < 36; i++) {
        const ph = (time * 0.035 + i * 0.137) % 1
        const pore = new THREE.Vector3(((i * 7) % 5 - 2) * 30, ((i * 3) % 5 - 2) * 30, 0)
        const pIn = onShell(pore.x, pore.y, 492)
        const pOut = onShell(pore.x, pore.y, 512)
        const src = NUCLEOLUS.clone().add(new THREE.Vector3(Math.sin(i) * 20, Math.cos(i * 1.3) * 20, Math.sin(i * 2.1) * 20))
        const p = ph < 0.7 ? src.clone().lerp(pIn, smoothstep(0, 0.7, ph)) : pIn.clone().lerp(pOut, (ph - 0.7) / 0.3)
        this.q.setFromEuler(new THREE.Euler(i, i * 2.3, time * 0.2 + i))
        this.m.compose(p, this.q, this.s.setScalar(1))
        if (i % 2) this.subL.setMatrixAt(a++, this.m)
        else this.subS.setMatrixAt(b++, this.m)
      }
      this.subL.count = a
      this.subS.count = b
      this.subL.instanceMatrix.needsUpdate = true
      this.subS.instanceMatrix.needsUpdate = true
      this.s.set(1, 1, 1)
      // mRNA strands snaking out through pores
      for (let j = 0; j < 5; j++) {
        const pu = (j - 2) * 30
        const pv = ((j * 2) % 5 - 2) * 30
        const ph = (time * 0.05 + j * 0.31) % 1
        for (let i = 0; i < 40; i++) {
          const s = ph * 60 - i * 0.9
          if (s < 0 || s > 40) continue
          const rr = 480 + s * 0.9
          const p = onShell(pu + Math.sin(s * 0.4 + j) * 1.5, pv + Math.cos(s * 0.33 + j) * 1.5, rr)
          this.bead(p, 0.22, '#ff8a5a')
        }
      }
    }

    /* Ca²⁺: pumped into the smooth ER, then released */
    if (st.caOn > 0.01) {
      const r = rng(31)
      for (let i = 0; i < 900; i++) {
        // a lumen site: on a tubule of the smooth-ER net (inverting its warp a few times)
        const gx = Math.floor(r() * 7) - 1, gy = -3 - Math.floor(r() * 8), gz = Math.floor(r() * 7) - 3
        const axis = Math.floor(r() * 3)
        const w = new THREE.Vector3(gx * 24 + 12, gy * 24 + 12, gz * 24 + 12)
        w.setComponent(axis, w.getComponent(axis) + (r() - 0.5) * 24)
        const lum = invertWarp(w)
        const rr = lum.clone().sub(NC).length()
        if (rr < 572 || rr > 600 + 40 * st.ser || lum.y > -72 || lum.y < -230) continue
        const cyt = lum.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(22))
        // pumped in during uptake (st.caIn), out in a burst on release (st.caOut)
        const inK = smoothstep(r() * 0.4, r() * 0.4 + 0.6, st.caIn) * (1 - smoothstep(r() * 0.2, r() * 0.2 + 0.5, st.caOut))
        const p = cyt.clone().lerp(lum, inK).add(new THREE.Vector3(Math.sin(time * 3 + i), Math.cos(time * 2.6 + i * 1.7), Math.sin(time * 2.2 + i * 0.7)).multiplyScalar(inK > 0.9 ? 0.5 : 2.0))
        this.bead(p, 0.55, this.c.setRGB(0.6, 1.0, 0.9).multiplyScalar(1.4))
      }
    }

    /* lysosomes: hydrolytic enzymes inside; one swells with undigested lipid */
    if (st.lysoOn > 0.01) {
      const r = rng(77)
      LYSO.forEach((L, li) => {
        const R = li === 0 ? 15 * (1 + 0.9 * st.store) : li === 1 ? 12 : 11
        const c = li === 1 ? st.ly1 : li === 2 ? st.ly2 : L
        for (let i = 0; i < 34; i++) {
          const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(R * 0.75 * Math.cbrt(r()))
          d.add(new THREE.Vector3(Math.sin(time * 1.3 + i), Math.cos(time * 1.1 + i * 2.0), Math.sin(time * 0.9 + i * 3.0)).multiplyScalar(0.6))
          this.bead(c.clone().add(d), 0.9, '#ff6a4a')
        }
        if (li === 0) {
          const ng = Math.floor(st.store * 40)
          for (let i = 0; i < ng; i++) {
            const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(R * 0.62 * Math.cbrt(r()))
            this.bead(L.clone().add(d), 2.2 + r() * 1.6, '#ffe8a8')
          }
        }
      })
    }

    this.beads.count = this.beadN
    this.beads.instanceMatrix.needsUpdate = true
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true
  }
}

/** the inside set's stage values, from the film */
export type InsideStage = {
  chromC: number
  chromOn: number
  ribOn: number
  hero: number
  assemble: number
  transl: number
  dock: number
  glyco: number
  export: number
  caOn: number
  caIn: number
  caOut: number
  ser: number
  lysoOn: number
  store: number
  ly1: THREE.Vector3
  ly2: THREE.Vector3
}

/* the smooth ER's warp (the same as in inside.ts), inverted by fixed-point iteration */
const sn3 = (x: number, y: number, z: number) => Math.sin(x * 1.7 + Math.sin(y * 1.3 + z * 0.7)) * Math.sin(y * 1.1 + Math.sin(z * 1.9)) * Math.sin(z * 1.3 + Math.sin(x * 0.9))
function invertWarp(w: THREE.Vector3) {
  const p = w.clone()
  for (let i = 0; i < 5; i++) {
    const a = 0.03
    const dx = 6 * sn3(p.x * a, p.y * a, p.z * a)
    const dy = 6 * sn3(p.y * a + 5, p.z * a + 5, p.x * a + 5)
    const dz = 6 * sn3(p.z * a + 9, p.x * a + 9, p.y * a + 9)
    p.set(w.x - dx, w.y - dy, w.z - dz)
  }
  return p
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export { HASH, NOISE }
