import * as THREE from 'three'
import { U } from './uniforms'
import { HASH, NOISE } from './glsl'
import { blob, glob, V, molMat } from './mol'

/* ==========================================================================
   OUTSIDE THE MEMBRANE — 1 unit = 10 nm.
   x ≈ 0     a plant cell wall, being built. Cellulose synthase complexes
             (rosettes of six) ride the cortical microtubules inside the
             membrane and spin cellulose microfibrils out behind them. The
             fibrils set in a matrix of other polysaccharides. A thin, criss-
             crossed primary wall; the pectin-rich middle lamella gluing it to
             the neighbour's; then, between membrane and primary wall, the
             secondary wall in laminated layers whose fibrils turn with each
             layer. Through it all, a plasmodesma: a channel lined by plasma
             membrane continuous from cell to cell, with a strand of ER (the
             desmotubule) down its middle.
   x ≈ 900   an animal cell's extracellular matrix: banded collagen fibrils
             in a web of proteoglycan complexes (bottlebrushes on a long
             polysaccharide), fibronectin linking them to integrins, which
             span the membrane and grip actin microfilaments inside. A signal
             runs from matrix to cytoskeleton, toward the nucleus.
   ========================================================================== */

export const ECM = { wall: new THREE.Vector3(0, 0, 0), pd: new THREE.Vector3(0, 0, 60), mat: new THREE.Vector3(900, 0, 0) }
const col = (h: string) => new THREE.Color(h).convertSRGBToLinear()

/* a membrane sheet: two leaflets of head groups, fluorescent at grazing angles */
function membraneMat(color: string) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: U.uTime, uColor: { value: col(color) }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      out vec3 vN; out vec3 vV; out vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * normal);
        vV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      ${HASH}${NOISE}
      uniform vec3 uColor; uniform float uFade, uTime;
      in vec3 vN; in vec3 vV; in vec3 vW;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(-vV);
        float c = abs(dot(n, v));
        float rim = 1.0 - c;
        // head groups: a fine stipple, drifting (the membrane is fluid)
        vec2 g = vW.xz * 1.4 + vec2(gnoise(vec3(vW.xz * 0.05, uTime * 0.05)) * 3.0);
        float dots = smoothstep(0.42, 0.2, length(fract(g) - 0.5));
        vec3 col = uColor * (0.15 + 0.35 * dots + 1.6 * rim * rim);
        float a = clamp(0.25 + 0.6 * rim * rim + 0.2 * dots, 0.0, 1.0) * uFade;
        col *= exp(-max(0.0, length(vV) - 60.0) * 0.004);
        o = vec4(col * a, a);
      }`,
  })
}

function inst(geo: THREE.BufferGeometry, color: THREE.Color, n: number, opts: { grain?: number; emissive?: number } = {}) {
  const m = new THREE.InstancedMesh(geo, molMat(color, { grain: opts.grain ?? 1.2, emissive: opts.emissive }), n)
  m.frustumCulled = false
  m.count = 0
  return m
}

export class Matrix {
  scene = new THREE.Scene()
  fibril: THREE.InstancedMesh
  rosette: THREE.InstancedMesh
  mtube: THREE.InstancedMesh
  tether: THREE.InstancedMesh
  pectin: THREE.Points
  pm: THREE.Mesh
  pm2: THREE.Mesh
  pdTube: THREE.Mesh
  desmo: THREE.Mesh
  // animal ECM
  collagen: THREE.InstancedMesh
  pgCore: THREE.InstancedMesh
  pgBristle: THREE.InstancedMesh
  fn: THREE.InstancedMesh
  integrin: THREE.InstancedMesh
  actin: THREE.InstancedMesh
  adaptor: THREE.InstancedMesh
  pmA: THREE.Mesh
  pulse: THREE.InstancedMesh
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  constructor() {
    const S = this.scene
    /* ---- plant wall ---- */
    this.fibril = inst(new THREE.CylinderGeometry(0.22, 0.22, 1, 6), col('#e9ffd0'), 3200, { grain: 0.5 })
    this.rosette = inst(blob(Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2
      return [Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9, 0.55] as [number, number, number, number]
    }), 24), col('#ff9fd8'), 40)
    this.mtube = inst(new THREE.CylinderGeometry(1.25, 1.25, 1, 14), col('#c4ff4d'), 12)
    this.tether = inst(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), col('#ffe08a'), 2400)
    // pectin: a sticky gel, drawn as a haze of faint points
    {
      const n = 24000
      const p = new Float32Array(n * 3)
      const c = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        p[i * 3] = (Math.random() - 0.5) * 240
        p[i * 3 + 1] = Math.random() * 60
        p[i * 3 + 2] = (Math.random() - 0.5) * 240
        c[i] = Math.random()
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      g.setAttribute('aR', new THREE.BufferAttribute(c, 1))
      this.pectin = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: { uLam: { value: 40 }, uAmt: { value: 1 }, uTime: U.uTime },
          vertexShader: /* glsl */ `
            in float aR; uniform float uLam, uAmt, uTime; out float vA;
            void main(){
              vec3 p = position;
              // most pectin sits in the middle lamella; a little in the primary wall
              float lam = exp(-pow2((p.y - uLam) / 2.5));
              vA = (0.35 * lam + 0.05) * uAmt * (0.5 + aR);
              p.y = mix(p.y, uLam + (aR - 0.5) * 5.0, step(0.55, aR));
              vec4 mv = viewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = clamp(220.0 / -mv.z, 1.0, 8.0);
            }
            `.replace('void main', 'float pow2(float x){ return x * x; }\nvoid main'),
          fragmentShader: /* glsl */ `
            precision highp float; layout(location=0) out vec4 o; in float vA;
            void main(){ float r = length(gl_PointCoord - 0.5); o = vec4(vec3(1.0, 0.7, 0.25) * vA * smoothstep(0.5, 0.0, r), 1.0); }`,
        }),
      )
      this.pectin.frustumCulled = false
    }
    const plane = new THREE.PlaneGeometry(260, 260, 1, 1).rotateX(-Math.PI / 2)
    this.pm = new THREE.Mesh(plane, membraneMat('#8cf2ff'))
    this.pm2 = new THREE.Mesh(plane, membraneMat('#8cf2ff'))
    // the plasmodesma: membrane-lined channel through both walls, desmotubule inside
    const lathe = (r: number) => new THREE.CylinderGeometry(r, r, 1, 40, 1, true)
    this.pdTube = new THREE.Mesh(lathe(2.6), membraneMat('#8cf2ff'))
    this.desmo = new THREE.Mesh(lathe(0.9), membraneMat('#7dffa0'))
    for (const o of [this.fibril, this.rosette, this.mtube, this.tether, this.pectin, this.pm, this.pm2, this.pdTube, this.desmo]) ((o.frustumCulled = false), S.add(o))

    /* ---- animal ECM ---- */
    this.collagen = inst(new THREE.CylinderGeometry(5, 5, 1, 24, 1, false), col('#ffd9b3'), 40, { grain: 0.4 })
    ;(this.collagen.material as THREE.ShaderMaterial).onBeforeCompile = () => {}
    this.collagenBands()
    this.pgCore = inst(new THREE.CylinderGeometry(0.35, 0.35, 1, 6), col('#8dff7a'), 900)
    this.pgBristle = inst(new THREE.CylinderGeometry(0.08, 0.08, 1, 4), col('#c8ff9a'), 9000)
    this.fn = inst(new THREE.SphereGeometry(0.9, 10, 8), col('#ffb86b'), 600)
    this.integrin = inst(blob([...glob(V(0, 3.2, 0), 1.6, 8, 41, V(1.2, 0.8, 1)), ...glob(V(-0.8, -0.2, 0), 0.6, 4, 43), ...glob(V(0.8, -0.2, 0), 0.6, 4, 47), ...glob(V(-0.6, 1.2, 0), 0.7, 4, 53), ...glob(V(0.6, 1.2, 0), 0.7, 4, 59)], 30), col('#e05cff'), 30)
    this.actin = inst(new THREE.CylinderGeometry(0.35, 0.35, 1, 8), col('#ff8a4a'), 80)
    this.adaptor = inst(blob(glob(V(0, 0, 0), 1.2, 6, 61), 20), col('#ff6fb0'), 30)
    this.pmA = new THREE.Mesh(plane, membraneMat('#8cf2ff'))
    this.pulse = inst(new THREE.SphereGeometry(1.2, 12, 10), col('#ffffff'), 60, { emissive: 3 })
    for (const o of [this.collagen, this.pgCore, this.pgBristle, this.fn, this.integrin, this.actin, this.adaptor, this.pmA, this.pulse]) ((o.frustumCulled = false), S.add(o))
  }

  /* collagen's 67-nm banding, painted on in the fragment shader */
  private collagenBands() {
    const mat = this.collagen.material as THREE.ShaderMaterial
    mat.fragmentShader = mat.fragmentShader.replace(
      'vec3 col = uColor * vC;',
      'vec3 col = uColor * vC * (0.75 + 0.35 * smoothstep(0.2, 0.0, abs(fract(dot(vWP, normalize(vec3(1.0, 0.0, 0.2))) / 6.7) - 0.5) - 0.18));',
    )
  }

  private put(im: THREE.InstancedMesh, i: number, a: THREE.Vector3, b: THREE.Vector3, r = 1) {
    const d = b.clone().sub(a)
    const L = d.length()
    this.q.setFromUnitVectors(this.up, d.normalize())
    this.m.compose(a.clone().add(b).multiplyScalar(0.5), this.q, this.s.set(r, L, r))
    im.setMatrixAt(i, this.m)
  }

  update(st: EcmStage, time: number) {
    const W = ECM.wall
    /* ---- the plant wall ---- */
    const wallOn = st.wall > 0.01
    for (const o of [this.fibril, this.rosette, this.mtube, this.tether, this.pectin, this.pm, this.pm2]) o.visible = wallOn
    // the secondary wall thickens inward, pushing the membrane down
    const sec = st.sec
    const pmY = -sec * 16
    this.pm.position.set(W.x, W.y + pmY, W.z)
    this.pm2.position.set(W.x, W.y + 80, W.z)
    ;(this.pectin.material as THREE.ShaderMaterial).uniforms.uLam.value = 40
    ;(this.pectin.material as THREE.ShaderMaterial).uniforms.uAmt.value = st.lamella
    let nf = 0
    let nt = 0
    // primary walls (ours below the lamella, the neighbour's above): fibrils criss-crossed loosely
    const layer = (y0: number, y1: number, count: number, angle: number, spread: number, grow: number, seed: number) => {
      let s = seed
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < count && nf < 3200; i++) {
        const y = y0 + (y1 - y0) * rnd()
        const a = angle + (rnd() - 0.5) * spread
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
        const c = new THREE.Vector3((rnd() - 0.5) * 220, y, (rnd() - 0.5) * 220).add(W)
        const L = 140 * Math.min(1, Math.max(0, grow * 1.4 - rnd() * 0.4))
        if (L < 1) continue
        this.put(this.fibril, nf++, c.clone().addScaledVector(dir, -L / 2), c.clone().addScaledVector(dir, L / 2), 1)
        // hemicellulose tethers to the next fibril
        if (i % 3 === 0 && nt < 2400) {
          const b = c.clone().add(new THREE.Vector3(Math.sin(a) * 3, (rnd() - 0.5) * 2, -Math.cos(a) * 3))
          this.put(this.tether, nt++, c, b, 1)
        }
      }
    }
    layer(26, 37, 260, 0.3, 2.6, st.primary, 3)
    layer(43, 54, 260, 1.1, 2.6, st.primary, 7)
    // secondary wall: three laminated layers, the fibrils turning from one to the next
    layer(pmY + 1, pmY + 5.5, 300, 1.1, 0.25, smooth(st.sec * 3), 11)
    layer(pmY + 6, pmY + 11, 300, -0.4, 0.2, smooth(st.sec * 3 - 1), 13)
    layer(pmY + 11.5, pmY + 16, 300, 0.7, 0.25, smooth(st.sec * 3 - 2), 17)
    // the youngest fibrils, being spun right now by rosettes riding the microtubules beneath the membrane
    let nr = 0
    let nm = 0
    for (let k = 0; k < 5; k++) {
      const z = -40 + k * 20
      const mtY = pmY - 4
      this.put(this.mtube, nm++, new THREE.Vector3(-130, mtY, z).add(W), new THREE.Vector3(130, mtY, z).add(W), 1)
      for (let j = 0; j < 3; j++) {
        const x = -100 + ((time * 6 + j * 70 + k * 23) % 200)
        const p = new THREE.Vector3(x, pmY + 0.2, z + 2.5).add(W)
        this.q.identity()
        this.m.compose(p, this.q, this.s.set(1, 1, 1))
        this.rosette.setMatrixAt(nr++, this.m)
        // the fibril trailing out behind it, just above the membrane
        this.put(this.fibril, nf++, p.clone().add(new THREE.Vector3(-Math.min(60, x + 100), 1.2, 0)), p.clone().add(new THREE.Vector3(0, 1.2, 0)), 1)
      }
    }
    this.fibril.count = nf
    this.tether.count = nt
    this.rosette.count = nr
    this.mtube.count = nm
    for (const im of [this.fibril, this.tether, this.rosette, this.mtube]) im.instanceMatrix.needsUpdate = true

    /* the plasmodesma */
    this.pdTube.visible = this.desmo.visible = st.pd > 0.01
    const pd = ECM.pd
    this.pdTube.position.set(pd.x, (pmY + 80) / 2, pd.z)
    this.pdTube.scale.set(1, 80 - pmY, 1)
    this.desmo.position.copy(this.pdTube.position)
    this.desmo.scale.copy(this.pdTube.scale)

    /* ---- the animal ECM ---- */
    const on = st.ecm > 0.01
    for (const o of [this.collagen, this.pgCore, this.pgBristle, this.fn, this.integrin, this.actin, this.adaptor, this.pmA, this.pulse]) o.visible = on
    if (!on) return
    const M = ECM.mat
    this.pmA.position.copy(M)
    let n = 0
    // collagen fibrils, 100 nm thick, criss-crossing above the membrane
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7
      const dir = new THREE.Vector3(Math.cos(a), 0.05 * Math.sin(i), Math.sin(a))
      const c = M.clone().add(new THREE.Vector3((i - 4) * 18, 38 + (i % 3) * 14, ((i * 7) % 5 - 2) * 20))
      this.put(this.collagen, n++, c.clone().addScaledVector(dir, -160), c.clone().addScaledVector(dir, 160), 1)
    }
    this.collagen.count = n
    // proteoglycan complexes: long hyaluronan chains with hundreds of bottlebrush proteoglycans
    let nc = 0, nb = 0
    for (let k = 0; k < 4; k++) {
      const a = k * 1.4 + 0.3
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const c = M.clone().add(new THREE.Vector3((k - 1.5) * 40, 22 + k * 9, (k - 1.5) * 25))
      for (let i = 0; i < 60; i++) {
        const s = (i / 59 - 0.5) * 220
        const p = c.clone().addScaledVector(dir, s).add(new THREE.Vector3(0, Math.sin(s * 0.05 + k) * 3, 0))
        if (i < 59) {
          const p2 = c.clone().addScaledVector(dir, ((i + 1) / 59 - 0.5) * 220).add(new THREE.Vector3(0, Math.sin(((i + 1) / 59 - 0.5) * 220 * 0.05 + k) * 3, 0))
          this.put(this.pgCore, nc++, p, p2, 0.6)
        }
        if (i % 3 !== 0) continue
        // one proteoglycan: a core protein with sugar chains (glycosaminoglycans)
        const side = new THREE.Vector3(-dir.z, 0, dir.x).applyAxisAngle(dir, i * 0.9)
        const tip = p.clone().addScaledVector(side, 14)
        this.put(this.pgCore, nc++, p, tip, 1)
        for (let j = 1; j < 9 && nb < 9000; j++) {
          const q = p.clone().lerp(tip, j / 9)
          for (const sgn of [1, -1]) {
            const b = q.clone().add(new THREE.Vector3(0, sgn * 3.2, 0).applyAxisAngle(side, i))
            this.put(this.pgBristle, nb++, q, b, 1)
          }
        }
      }
    }
    this.pgCore.count = nc
    this.pgBristle.count = nb
    // integrins in the membrane, fibronectin from their heads up to a collagen fibril, actin below
    let ni = 0, nfn = 0, na = 0, nd = 0, np = 0
    for (let k = 0; k < 7; k++) {
      const x = (k - 3) * 22
      const z = Math.sin(k * 1.7) * 30
      const base = M.clone().add(new THREE.Vector3(x, 0, z))
      this.q.identity()
      this.m.compose(base, this.q, this.s.set(1, 1, 1))
      this.integrin.setMatrixAt(ni++, this.m)
      // fibronectin: a dimer, two long arms joined at one end, each a string of domains
      const head = base.clone().add(new THREE.Vector3(0, 5, 0))
      const to = M.clone().add(new THREE.Vector3((Math.round(k * 1.3) - 4) * 18, 38 + (k % 3) * 14 - 5, ((k * 7) % 5 - 2) * 20))
      for (let arm = 0; arm < 2; arm++) {
        for (let i = 0; i < 14; i++) {
          const u = i / 13
          const p = head.clone().lerp(to, u).add(new THREE.Vector3((arm - 0.5) * 3 * Math.sin(u * Math.PI), Math.sin(u * Math.PI) * 4, 0))
          this.m.compose(p, this.q, this.s.set(1, 1, 1))
          this.fn.setMatrixAt(nfn++, this.m)
        }
      }
      // inside: adaptor proteins and actin microfilaments running toward the nucleus
      const ad = base.clone().add(new THREE.Vector3(0, -4.5, 0))
      this.m.compose(ad, this.q, this.s.set(1, 1, 1))
      this.adaptor.setMatrixAt(nd++, this.m)
      const end = ad.clone().add(new THREE.Vector3(Math.sin(k) * 30, -90, Math.cos(k) * 20))
      this.put(this.actin, na++, ad, end, 1)
      // a signal: from the matrix, through the integrin, down the microfilament
      if (st.signal > 0.01) {
        const ph = (st.signal * 1.6 + k * 0.07) % 1
        const path = [to, head, ad, end]
        const seg = Math.min(2, Math.floor(ph * 3))
        const f = ph * 3 - seg
        const p = path[seg].clone().lerp(path[seg + 1], f)
        this.m.compose(p, this.q, this.s.set(1, 1, 1))
        this.pulse.setMatrixAt(np++, this.m)
      }
    }
    this.integrin.count = ni
    this.fn.count = nfn
    this.actin.count = na
    this.adaptor.count = nd
    this.pulse.count = np
    for (const im of [this.collagen, this.pgCore, this.pgBristle, this.fn, this.integrin, this.actin, this.adaptor, this.pulse]) im.instanceMatrix.needsUpdate = true
  }
}

export type EcmStage = { wall: number; primary: number; lamella: number; sec: number; pd: number; ecm: number; signal: number }
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
export { HASH, NOISE }
