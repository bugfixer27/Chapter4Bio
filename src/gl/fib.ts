import * as THREE from 'three'
import { U } from './uniforms'
import { HASH, NOISE } from './glsl'
import { blob, glob, V, molMat } from './mol'

/* ==========================================================================
   THE CYTOSKELETON — 1 unit = 1 nm, every subunit drawn.
     MT0   a microtubule standing upright: α/β-tubulin dimers (8 nm) in 13
           protofilaments round a 15-nm lumen, the lattice rising 12 nm per
           turn (a 3-start helix, with its seam). It grows at the plus end
           under a cap of fresh dimers, then suffers catastrophe: the
           protofilaments peel outward in curls and it shrinks.
     MT1   a microtubule lying flat: the track for kinesin, which walks
           hand over hand, 8 nm per step, one ATP per step, carrying a
           vesicle by its receptor.
     F     an actin filament: two strands, 2.75 nm rise, −166.7° twist
           (a crossover every ≈ 36 nm), with myosin heads that row along it.
     IF    an intermediate filament: eight protofibrils wound into a rope.
     CEN   a centrosome: two centrioles at right angles, nine triplets each.
     AX    an axoneme in cross-section, 9 + 2: doublets, central pair,
           radial spokes, dynein arms, nexin links, the membrane; a basal
           body (9 + 0 triplets) beside it; two doublets side on, sliding or
           bending; and a field of beating cilia and one flagellum, drawn at
           1/100 scale (the readout says so).
   ========================================================================== */

export const FIB = {
  mt0: new THREE.Vector3(0, -200, 0),
  mt1: new THREE.Vector3(-320, -150, 200),
  actin: new THREE.Vector3(70, -150, 0),
  myo: new THREE.Vector3(70, -150, 0),
  ifil: new THREE.Vector3(130, -150, 0),
  cen: new THREE.Vector3(900, 0, 0),
  ax: new THREE.Vector3(2000, 0, 0),
  bb: new THREE.Vector3(2320, 0, 0),
  slide: new THREE.Vector3(2000, 600, 0),
  cil: new THREE.Vector3(4000, 0, 0),
}
const MT0_ROWS = 56
const MT1_ROWS = 84
const R_MT = 10.4

/* ---------------------------------------------------------------- tubulin */
function tubulinMesh() {
  const mono = blob([...glob(V(0, 0, 0), 2.2, 9, 3, V(1, 0.95, 1.1)), ...glob(V(0.6, 0.4, 1.2), 0.9, 3, 5)], 22)
  const n0 = 13 * MT0_ROWS * 2
  const n1 = 13 * MT1_ROWS * 2
  const N = n0 + n1
  const a = new Float32Array(N * 4) // pf, row, beta, mt
  let k = 0
  const push = (mt: number, rows: number) => {
    for (let r = 0; r < rows; r++) for (let pf = 0; pf < 13; pf++) for (let b = 0; b < 2; b++) {
      a[k * 4] = pf
      a[k * 4 + 1] = r
      a[k * 4 + 2] = b
      a[k * 4 + 3] = mt
      k++
    }
  }
  push(0, MT0_ROWS)
  push(1, MT1_ROWS)
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', mono.attributes.position)
  g.setAttribute('normal', mono.attributes.normal)
  g.setAttribute('aT', new THREE.InstancedBufferAttribute(a, 4))
  g.instanceCount = N
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTime: U.uTime, uLen0: { value: 40 }, uPeel: { value: 0 }, uCap: { value: 1 }, uFade: { value: 1 }, uLen1: { value: MT1_ROWS },
      uO0: { value: FIB.mt0 }, uO1: { value: FIB.mt1 }, uHiPf: { value: -1 }, uEnd: { value: 0 },
    },
    vertexShader: /* glsl */ `
      in vec4 aT;
      uniform float uTime, uLen0, uPeel, uCap, uLen1, uHiPf, uEnd;
      uniform vec3 uO0, uO1;
      out vec3 vN; out vec3 vV; out vec3 vC; out float vA;
      const float R = ${R_MT.toFixed(1)};
      void main(){
        float pf = aT.x, row = aT.y, beta = aT.z, mt = aT.w;
        float th = pf / 13.0 * 6.28318;
        // 3-start helix: each protofilament sits 12/13 nm above the one before; the seam closes the 13th
        float z = row * 8.0 + beta * 4.0 + pf * (12.0 / 13.0);
        vec3 radial = vec3(cos(th), 0.0, sin(th));
        vec3 p = radial * R + vec3(0.0, z, 0.0);
        vec3 nrm = normal;
        // monomers face outward
        mat3 Rm = mat3(radial, vec3(0.0, 1.0, 0.0), cross(radial, vec3(0.0, 1.0, 0.0)));
        vec3 local = Rm * position;
        vec3 nl = Rm * normal;
        float vis = 1.0;
        vec3 col = beta > 0.5 ? vec3(0.55, 0.95, 0.35) : vec3(0.88, 1.0, 0.72);
        if (mt < 0.5) {
          float L = uLen0 * 8.0;
          // fresh GTP-tubulin at the growing end
          float cap = smoothstep(L - 26.0, L - 4.0, z) * uCap;
          col = mix(col, vec3(1.0, 0.95, 0.55), cap * 0.8);
          // catastrophe: beyond L − peel, protofilaments curl outward like ram's horns
          float s = z - (L - uPeel);
          if (s > 0.0 && uPeel > 0.5) {
            float ang = s / 9.0;                         // curvature: one radian per 9 nm
            float rr = 9.0;
            vec3 out_ = radial * rr * (1.0 - cos(ang)) + vec3(0.0, rr * sin(ang), 0.0);
            p = radial * R + vec3(0.0, L - uPeel, 0.0) + out_;
            local = mat3(radial * cos(ang) + vec3(0.0, sin(ang), 0.0), vec3(0.0, cos(ang), 0.0) - radial * sin(ang), cross(radial, vec3(0.0, 1.0, 0.0))) * position;
          }
          if (z > L + 0.01) vis = 0.0;
          if (uHiPf >= 0.0 && abs(pf - uHiPf) < 0.5) col *= 1.6;
          p += uO0;
        } else {
          // lying along +x
          p = vec3(z, radial.x * R, radial.z * R);
          local = mat3(vec3(0.0, radial.x, radial.z), vec3(1.0, 0.0, 0.0), vec3(0.0, -radial.z, radial.x)) * position;
          nl = mat3(vec3(0.0, radial.x, radial.z), vec3(1.0, 0.0, 0.0), vec3(0.0, -radial.z, radial.x)) * normal;
          if (z > uLen1 * 8.0) vis = 0.0;
          p += uO1;
        }
        vec4 mv = viewMatrix * vec4(p + local, 1.0);
        vN = normalize(mat3(viewMatrix) * nl);
        vV = mv.xyz;
        vC = col;
        vA = vis;
        gl_Position = vis < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      uniform float uFade;
      in vec3 vN; in vec3 vV; in vec3 vC; in float vA;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(-vV);
        if (!gl_FrontFacing) n = -n;
        float dif = max(dot(n, normalize(vec3(-0.4, 0.8, 0.6))), 0.0);
        float wrap = dot(n, normalize(vec3(-0.4, 0.8, 0.6))) * 0.5 + 0.5;
        float rim = 1.0 - max(dot(n, v), 0.0); rim *= rim;
        vec3 c = vC * (0.14 + 0.5 * wrap + 0.25 * dif) + vC * rim * 1.1;
        c *= exp(-max(0.0, length(vV) - 120.0) * 0.0018) * uFade;
        o = vec4(c, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  return { mesh, mat }
}

/* ---------------------------------------------------------------- helpers */
const col = (h: string) => new THREE.Color(h).convertSRGBToLinear()
function inst(geo: THREE.BufferGeometry, color: THREE.Color, n: number) {
  const m = new THREE.InstancedMesh(geo, molMat(color, { grain: 0.8 }), n)
  m.frustumCulled = false
  m.count = 0
  return m
}

export class Cytoskeleton {
  scene = new THREE.Scene()
  tub = tubulinMesh()
  actin: THREE.InstancedMesh
  myoHead: THREE.InstancedMesh
  myoRod: THREE.Mesh
  ifSeg: THREE.InstancedMesh
  kin: THREE.Group
  kinHeads: THREE.Mesh[]
  kinStalk: THREE.Mesh
  cargo: THREE.Mesh
  receptor: THREE.Mesh
  cyl: THREE.InstancedMesh
  arms: THREE.InstancedMesh
  links: THREE.InstancedMesh
  rings: THREE.InstancedMesh
  cilia: THREE.Mesh
  flag: THREE.Mesh
  sperm: THREE.Mesh
  memb: THREE.Mesh
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  private c = new THREE.Color()
  stepCount = 0

  constructor() {
    this.scene.add(this.tub.mesh)
    // actin: globular subunits ≈ 5.4 nm
    this.actin = inst(blob(glob(V(0, 0, 0), 2.3, 8, 11, V(1.1, 0.95, 1)), 18), col('#ff8a4a'), 400)
    this.scene.add(this.actin)
    // myosin II: a thick-filament rod with heads that row
    this.myoHead = inst(blob([...glob(V(0, 0, 0), 3.2, 10, 13, V(1.3, 0.8, 0.9)), ...glob(V(-3.5, -2, 0), 1.2, 4, 15)], 26), col('#ffd36b'), 30)
    this.scene.add(this.myoHead)
    this.myoRod = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 200, 12).rotateZ(Math.PI / 2), molMat(col('#c9a24a')))
    this.myoRod.frustumCulled = false
    this.scene.add(this.myoRod)
    // intermediate filament: rope segments
    this.ifSeg = inst(new THREE.CapsuleGeometry(1.15, 3.2, 4, 8), col('#b886ff'), 600)
    this.scene.add(this.ifSeg)
    // kinesin: two heads, neck, stalk, a vesicle with its receptor
    this.kin = new THREE.Group()
    const head = blob([...glob(V(0, 0, 0), 2.4, 10, 17, V(1.3, 0.85, 0.9))], 26)
    this.kinHeads = [new THREE.Mesh(head, molMat(col('#ff5fb0'))), new THREE.Mesh(head, molMat(col('#ff5fb0')))]
    this.kinStalk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1, 8), molMat(col('#ff8fc8')))
    this.cargo = new THREE.Mesh(new THREE.SphereGeometry(28, 48, 32), molMat(col('#4fa6b8'), { grain: 0.3 }))
    this.receptor = new THREE.Mesh(blob(glob(V(0, 0, 0), 2.6, 8, 23), 22), molMat(col('#59e1ff')))
    for (const o of [...this.kinHeads, this.kinStalk, this.cargo, this.receptor]) ((o.frustumCulled = false), this.kin.add(o))
    this.scene.add(this.kin)
    // centrioles, axoneme tubes: instanced open cylinders (a tube wall), and end rings for the section
    const tube = new THREE.CylinderGeometry(12.5, 12.5, 1, 26, 1, true)
    this.cyl = inst(tube, col('#c4ff4d'), 260)
    this.cyl.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(260 * 3), 3)
    this.scene.add(this.cyl)
    const ring = new THREE.RingGeometry(10.5, 12.5, 26).rotateX(-Math.PI / 2)
    this.rings = inst(ring, col('#e8ffb0'), 260)
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(260 * 3), 3)
    this.scene.add(this.rings)
    this.arms = inst(blob([...glob(V(0, 0, 0), 4.0, 10, 29, V(1.4, 0.7, 0.8)), ...glob(V(6, 1, 0), 2, 4, 31)], 26), col('#ff4d4d'), 80)
    this.arms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3)
    this.scene.add(this.arms)
    this.links = inst(new THREE.CylinderGeometry(1.3, 1.3, 1, 8), col('#5aa0ff'), 80)
    this.scene.add(this.links)
    this.memb = new THREE.Mesh(new THREE.CylinderGeometry(125, 125, 120, 64, 1, true), molMat(col('#59e1ff'), { grain: 0.2 }))
    ;(this.memb.material as THREE.ShaderMaterial).side = THREE.DoubleSide
    this.memb.frustumCulled = false
    this.scene.add(this.memb)
    // cilia (1/100 scale): a carpet; each cilium a bendable tube
    this.cilia = this.ciliaMesh()
    this.scene.add(this.cilia)
    const fg = new THREE.CylinderGeometry(0.3, 0.3, 1, 8, 120, true)
    this.flag = new THREE.Mesh(fg, this.waveMat())
    this.flag.frustumCulled = false
    this.scene.add(this.flag)
    this.sperm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16).scale(2.6, 1.6, 1.6), molMat(col('#8cf2ff')))
    this.sperm.frustumCulled = false
    this.scene.add(this.sperm)
  }

  /* the carpet of cilia: power stroke straight and fast, recovery bent and slow, phase shifted across the field (metachronal waves) */
  private ciliaMesh() {
    const base = new THREE.CylinderGeometry(0.11, 0.11, 1, 6, 24, false)
    base.translate(0, 0.5, 0)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    g.setAttribute('normal', base.attributes.normal)
    const N = 16 * 12
    const at = new Float32Array(N * 2)
    for (let i = 0; i < N; i++) {
      at[i * 2] = i % 16
      at[i * 2 + 1] = Math.floor(i / 16)
    }
    g.setAttribute('aG', new THREE.InstancedBufferAttribute(at, 2))
    g.instanceCount = N
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTime: U.uTime, uO: { value: FIB.cil }, uFade: { value: 1 }, uBeat: { value: 1 } },
      vertexShader: /* glsl */ `
        in vec2 aG;
        uniform float uTime, uBeat;
        uniform vec3 uO;
        out vec3 vN; out vec3 vV;
        void main(){
          float s = position.y;                  // 0 at the base, 1 at the tip
          float Lc = 7.0;                        // 7 µm, at 1/100 scale: 70 units
          float ph = fract(uTime * 0.9 * uBeat - aG.x * 0.06 - aG.y * 0.015);
          // power stroke (first third): stiff, sweeping forward; recovery: bent, sweeping back low
          float pw = smoothstep(0.0, 0.33, ph) * (1.0 - step(0.33, ph));
          float rc = smoothstep(0.33, 1.0, ph);
          float ang;
          vec2 q;
          if (ph < 0.33) {
            ang = mix(-1.1, 1.1, pw);
            q = vec2(sin(ang), cos(ang)) * s;
          } else {
            float a0 = mix(1.1, -1.1, rc);
            float bend = sin(rc * 3.14159) * 1.9;
            float a = a0 - bend * s;
            q = vec2(sin(a0 - bend * s * 0.5), cos(a0 - bend * s * 0.5)) * s;
          }
          vec3 p = vec3(q.x, q.y, 0.0) * Lc * 10.0 + vec3(position.x, 0.0, position.z) * 10.0;
          p += uO + vec3(aG.x * 9.0 - 70.0, 0.0, aG.y * 9.0 - 50.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vN = normalize(mat3(viewMatrix) * normal);
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
          vec3 c = vec3(0.55, 0.95, 1.0) * (0.25 + 1.3 * rim * rim);
          c *= exp(-max(0.0, length(vV) - 200.0) * 0.002) * uFade;
          o = vec4(c, 1.0);
        }`,
    })
    const mesh = new THREE.Mesh(g, mat)
    mesh.frustumCulled = false
    return mesh
  }
  /* a flagellum: a wave travelling from base to tip, the beat of a sperm's tail */
  private waveMat() {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTime: U.uTime, uO: { value: FIB.cil.clone().add(new THREE.Vector3(150, 40, 0)) }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uO;
        out vec3 vN; out vec3 vV;
        void main(){
          float s = position.y + 0.5;            // 0 at the head, 1 at the tail
          float L = 50.0;
          float amp = 7.0 * smoothstep(0.0, 0.3, s);
          float x = -s * L;
          float y = amp * sin(s * 10.0 - uTime * 9.0);
          vec3 p = uO + vec3(x, y, 0.0) + vec3(position.x, 0.0, position.z) * (1.0 - s * 0.5);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vN = normalize(mat3(viewMatrix) * normal);
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
          o = vec4(vec3(0.55, 0.95, 1.0) * (0.3 + 1.4 * rim * rim) * uFade, 1.0);
        }`,
    })
  }

  /** drive everything from the stage values */
  update(st: FibStage, time: number) {
    const tu = this.tub.mat.uniforms
    tu.uLen0.value = st.len0
    tu.uPeel.value = st.peel
    tu.uCap.value = st.cap
    tu.uFade.value = st.fade
    tu.uHiPf.value = st.hiPf
    const up = new THREE.Vector3(0, 1, 0)

    /* actin: two strands wound round each other; myosin heads row along it */
    let n = 0
    const A0 = FIB.actin
    for (let i = 0; i < 300 && n < 400; i++) {
      const ang = i * (-166.67 * Math.PI) / 180
      const p = new THREE.Vector3(Math.cos(ang) * 2.6, i * 2.75 - 380 + st.slide * 0, Math.sin(ang) * 2.6).add(A0)
      p.y += st.slide
      this.q.setFromAxisAngle(up, -ang)
      this.m.compose(p, this.q, this.s.set(1, 1, 1))
      this.actin.setMatrixAt(n++, this.m)
    }
    this.actin.count = n
    this.actin.instanceMatrix.needsUpdate = true
    // myosin II: heads bind, swing (the power stroke), release: actin is pulled along
    n = 0
    this.myoRod.visible = st.myo > 0.01
    this.myoHead.visible = st.myo > 0.01
    if (st.myo > 0.01) {
      this.myoRod.position.copy(A0).add(new THREE.Vector3(22, -150, 0))
      this.myoRod.rotation.set(0, 0, Math.PI / 2)
      for (let i = 0; i < 14; i++) {
        const ph = (time * 1.2 + i * 0.37) % 1
        const swing = ph < 0.5 ? Math.sin((ph / 0.5) * Math.PI * 0.5) : 1 - (ph - 0.5) / 0.5
        const y = -240 + i * 14 + (i % 2) * 6
        const p = new THREE.Vector3(A0.x + 9, A0.y + y + swing * 5, A0.z + (i % 2 ? 3 : -3))
        this.q.setFromEuler(new THREE.Euler(0, 0, -0.9 + swing * 1.0))
        this.m.compose(p, this.q, this.s.set(1, 1, 1))
        this.myoHead.setMatrixAt(n++, this.m)
      }
    }
    this.myoHead.count = n
    this.myoHead.instanceMatrix.needsUpdate = true

    /* intermediate filament: eight protofibrils twisted into a 10-nm rope */
    n = 0
    for (let f = 0; f < 8; f++) {
      for (let i = 0; i < 60; i++) {
        const y = i * 4.2 - 380
        const a = (f / 8) * Math.PI * 2 + y * 0.035
        const p = new THREE.Vector3(Math.cos(a) * 3.6, y, Math.sin(a) * 3.6).add(FIB.ifil)
        const t = new THREE.Vector3(-Math.sin(a) * 3.6 * 0.035, 1, Math.cos(a) * 3.6 * 0.035).normalize()
        this.q.setFromUnitVectors(up, t)
        this.m.compose(p, this.q, this.s.set(1, 1, 1))
        this.ifSeg.setMatrixAt(n++, this.m)
      }
    }
    this.ifSeg.count = n
    this.ifSeg.instanceMatrix.needsUpdate = true

    /* kinesin: hand over hand along MT1, 8 nm a step; the trailing head swings past the leading one */
    const rate = 1.6
    const tt = st.walk * 15 + (st.kin > 0.01 ? (time * 0.6) % 1 : 0) * 0
    const k = Math.floor(tt * rate)
    this.stepCount = Math.max(0, Math.floor(st.walk * 24))
    const f = tt * rate - k
    const sw = f < 0.5 ? smooth01(f / 0.5) : 1
    const base = FIB.mt1.clone().add(new THREE.Vector3(80 + k * 8, R_MT + 3.2, 0))
    const lead = k % 2 === 0
    const hA = base.clone().add(new THREE.Vector3(-8 + 16 * sw, Math.sin(sw * Math.PI) * 8, 0))
    const hB = base.clone()
    this.kinHeads[lead ? 0 : 1].position.copy(hA)
    this.kinHeads[lead ? 1 : 0].position.copy(hB)
    const top = base.clone().add(new THREE.Vector3(-2 + 8 * sw, 62, 0))
    const mid = hA.clone().lerp(hB, 0.5).add(new THREE.Vector3(0, 5, 0))
    const d = top.clone().sub(mid)
    this.kinStalk.position.copy(mid).addScaledVector(d, 0.5)
    this.kinStalk.scale.set(1, d.length(), 1)
    this.kinStalk.quaternion.setFromUnitVectors(up, d.normalize())
    this.receptor.position.copy(top).add(new THREE.Vector3(0, 2.5, 0))
    this.cargo.position.copy(top).add(new THREE.Vector3(0, 30, 0))
    // the head that just landed flashes: one ATP
    ;(this.kinHeads[lead ? 0 : 1].material as THREE.ShaderMaterial).uniforms.uHi.value = f < 0.15 ? 1 : 0
    this.kin.visible = st.kin > 0.01

    /* centrioles: two barrels of nine triplets at right angles, 250 nm across */
    n = 0
    let nr = 0
    const putTube = (p: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, color: THREE.Color, ring = true) => {
      this.q.setFromUnitVectors(up, dir.clone().normalize())
      this.m.compose(p, this.q, this.s.set(r / 12.5, len, r / 12.5))
      this.cyl.setMatrixAt(n, this.m)
      this.cyl.setColorAt(n, color)
      n++
      if (ring) {
        const pe = p.clone().addScaledVector(dir.clone().normalize(), len / 2)
        this.m.compose(pe, this.q, this.s.set(r / 12.5, 1, r / 12.5))
        this.rings.setMatrixAt(nr, this.m)
        this.rings.setColorAt(nr, color)
        nr++
      }
    }
    const green = col('#c4ff4d')
    if (st.cen > 0.01) {
      for (const [o, dir] of [[FIB.cen, new THREE.Vector3(0, 1, 0)], [FIB.cen.clone().add(new THREE.Vector3(0, -180, 200)), new THREE.Vector3(0, 0, 1)]] as [THREE.Vector3, THREE.Vector3][]) {
        const ax = dir.clone()
        const t1 = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(1, 0.2, 0)).normalize()
        const t2 = new THREE.Vector3().crossVectors(ax, t1)
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2
          const rad = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a))
          const tang = t1.clone().multiplyScalar(-Math.sin(a)).addScaledVector(t2, Math.cos(a))
          for (let j = 0; j < 3; j++) {
            const p = o.clone().addScaledVector(rad, 100 - j * 4).addScaledVector(tang, (j - 1) * 21)
            putTube(p, ax, 420, 12.5, green.clone().multiplyScalar(1 - j * 0.12))
          }
        }
      }
      // microtubules growing out from the pericentriolar material
      for (let i = 0; i < 18; i++) {
        const dir = new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i * 1.3), Math.cos(i * 2.4) * 0.8, Math.sin(i * 1.3)).normalize()
        const L = 900
        putTube(FIB.cen.clone().addScaledVector(dir, 260 + L / 2), dir, L, 12.5, green.clone().multiplyScalar(0.7), false)
      }
    }

    /* the axoneme, 9 + 2, and a basal body, 9 + 0 */
    let na = 0
    let nl = 0
    if (st.ax > 0.01) {
      const z = new THREE.Vector3(0, 0, 1)
      const tubeCol = col('#c4ff4d')
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.PI / 2
        const rad = new THREE.Vector3(Math.cos(a), Math.sin(a), 0)
        const tang = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0)
        const pA = FIB.ax.clone().addScaledVector(rad, 82)
        const pB = pA.clone().addScaledVector(tang, -19).addScaledVector(rad, 4)
        putTube(pA, z, 120, 12.5, tubeCol)
        putTube(pB, z, 120, 11.5, tubeCol.clone().multiplyScalar(0.85))
        // dynein arms on each A tubule, reaching for the next doublet's B tubule
        const reach = Math.sin(time * 3 + i * 0.7) * 0.25 * st.dyn
        for (const [off, dz] of [[6, 30], [10, -30]] as [number, number][]) {
          const p = pA.clone().addScaledVector(tang, 14).addScaledVector(rad, off - 6).add(new THREE.Vector3(0, 0, dz))
          this.q.setFromAxisAngle(z, a + Math.PI / 2 + reach)
          this.m.compose(p, this.q, this.s.set(1, 1, 1))
          this.arms.setMatrixAt(na, this.m)
          this.arms.setColorAt(na, this.c.set('#ff4d4d'))
          na++
        }
        // radial spoke to the central sheath; nexin link to the neighbour
        const sp = FIB.ax.clone().addScaledVector(rad, 55)
        this.q.setFromUnitVectors(up, rad)
        this.m.compose(sp, this.q, this.s.set(1, 42, 1))
        this.links.setMatrixAt(nl++, this.m)
        if (st.links > 0.5) {
          const an = ((i + 0.5) / 9) * Math.PI * 2 + Math.PI / 2
          const pn = FIB.ax.clone().add(new THREE.Vector3(Math.cos(an), Math.sin(an), 0).multiplyScalar(86))
          this.q.setFromUnitVectors(up, new THREE.Vector3(-Math.sin(an), Math.cos(an), 0))
          this.m.compose(pn, this.q, this.s.set(0.8, 22, 0.8))
          this.links.setMatrixAt(nl++, this.m)
        }
      }
      // the central pair
      putTube(FIB.ax.clone().add(new THREE.Vector3(-15, 0, 0)), z, 120, 12.5, tubeCol)
      putTube(FIB.ax.clone().add(new THREE.Vector3(15, 0, 0)), z, 120, 12.5, tubeCol)
      // basal body: nine triplets, no central pair
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + Math.PI / 2
        const rad = new THREE.Vector3(Math.cos(a), Math.sin(a), 0)
        const tang = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0).applyAxisAngle(z, -0.6)
        for (let j = 0; j < 3; j++) putTube(FIB.bb.clone().addScaledVector(rad, 92).addScaledVector(tang, (j - 1) * 21), z, 120, 11.5, tubeCol.clone().multiplyScalar(1 - j * 0.12))
      }
    }
    /* two doublets side on: dynein walks; held together they bend, cut apart they slide */
    if (st.slideOn > 0.01) {
      const o = FIB.slide
      const bend = st.links > 0.5 ? st.bend : 0
      const slide = st.links > 0.5 ? 0 : st.slideAmt
      for (let s = 0; s < 2; s++) {
        for (let i = 0; i < 12; i++) {
          const u = i / 11
          const L = 520
          const y = u * L - L / 2
          const curve = bend * (u * u) * 140
          const p = o.clone().add(new THREE.Vector3(-30 + s * 60 + curve, y + (s === 1 ? slide * 120 * (1) : 0), 0))
          putTube(p, new THREE.Vector3(bend * u * 0.9, 1, 0).normalize(), L / 11 + 2, 12.5, tubeCol(s), false)
          if (s === 0 && i % 2 === 0 && na < 80) {
            this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.2 + Math.sin(time * 4 + i) * 0.35 * st.dyn)
            this.m.compose(p.clone().add(new THREE.Vector3(30, 0, 0)), this.q, this.s.set(1, 1, 1))
            this.arms.setMatrixAt(na, this.m)
            this.arms.setColorAt(na, this.c.set('#ff4d4d'))
            na++
          }
          if (s === 0 && st.links > 0.5 && i % 3 === 1 && nl < 80) {
            this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
            this.m.compose(p.clone().add(new THREE.Vector3(30, 18, 0)), this.q, this.s.set(0.8, 56, 0.8))
            this.links.setMatrixAt(nl++, this.m)
          }
        }
      }
    }
    this.cyl.count = n
    this.rings.count = nr
    this.arms.count = na
    this.links.count = nl
    for (const im of [this.cyl, this.rings, this.arms, this.links]) {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    }
    this.memb.visible = st.ax > 0.01
    this.memb.position.copy(FIB.ax)
    this.memb.rotation.set(Math.PI / 2, 0, 0)

    /* cilia and a flagellum */
    this.cilia.visible = st.cil > 0.01
    this.flag.visible = this.sperm.visible = st.cil > 0.01
    this.sperm.position.copy(FIB.cil).add(new THREE.Vector3(150 + 3, 40, 0))
    ;(this.cilia.material as THREE.ShaderMaterial).uniforms.uBeat.value = st.beat
    function tubeCol(s: number) {
      return col(s === 0 ? '#c4ff4d' : '#a6e83a')
    }
  }
}

export type FibStage = {
  len0: number
  peel: number
  cap: number
  fade: number
  hiPf: number
  slide: number
  myo: number
  walk: number
  kin: number
  cen: number
  ax: number
  dyn: number
  links: number
  slideOn: number
  slideAmt: number
  bend: number
  cil: number
  beat: number
}
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
export { HASH, NOISE }
