import * as THREE from 'three'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'

/* ==========================================================================
   THE CELL — 393 216 points, 1 unit = 1 µm, drawn like a multi-channel
   fluorescence micrograph: every structure in its own dye colour.

   Each point has a home on one structure, and four more homes it can
   travel to, so one set of points plays every part:
     position   the animal cell of Figure 4.7
     aPlant     the plant cell of Figure 4.7 (wall, central vacuole,
                chloroplasts appear; lysosomes, centrioles, microvilli,
                the flagellum and intermediate filaments go)
     aMap       the flat review diagram of the endomembrane system (Fig. 4.15)
     (shader)   a centrifuge tube: the homogenate, then four pellets
     (shader)   a macrophage reaching for a bacterium (Fig. 4.29)
   Everything that moves is computed in the vertex shader from time and
   the point's own attributes, so the cell is stateless: scrolling back
   reverses it exactly.

   The same points also feed eight microscopes. For each, the shader
   writes the signal that instrument would record (dye emission, stain
   absorbance, optical density, secondary electrons, electron scattering
   in a thin slice); post.scopePass turns it into the picture.
   ========================================================================== */

export const N = 768 * 512

export const T = {
  PM: 0, NE: 1, CHROM: 2, RER: 3, SER: 4, GOLGI: 5, MITO: 6, LYSO: 7, VES: 8, MT: 9, ACTIN: 10, IF: 11, HAZE: 12, CENT: 13,
  PEROX: 14, RIBO: 15, VILLI: 16, FLAG: 17, BACT: 18, WALL: 19, CHLORO: 20, VAC: 21,
} as const
export const NTAG = 22

/* fluorescence palette, linear RGB, deliberately saturated */
export const COLORS: [number, number, number][] = [
  [0.55, 0.95, 1.0], // PM · cyan membrane dye
  [0.25, 0.42, 1.0], // nuclear envelope · blue
  [0.18, 0.26, 0.95], // chromatin · DAPI
  [0.25, 1.0, 0.45], // rough ER · green
  [0.45, 0.95, 0.75], // smooth ER · mint
  [1.0, 0.66, 0.18], // Golgi · amber
  [1.0, 0.22, 0.52], // mitochondria · magenta
  [1.0, 0.3, 0.2], // lysosomes · red
  [1.0, 0.92, 0.6], // vesicles · warm white
  [0.78, 1.0, 0.3], // microtubules · yellow-green
  [1.0, 0.42, 0.18], // actin · orange
  [0.72, 0.45, 1.0], // intermediate filaments · violet
  [0.35, 0.45, 0.6], // cytosol · dim
  [1.0, 1.0, 1.0], // centrioles
  [1.0, 0.93, 0.4], // peroxisomes · lemon
  [0.85, 1.0, 0.9], // free ribosomes · pale
  [0.55, 0.95, 1.0], // microvilli · membrane
  [0.6, 0.9, 1.0], // flagellum
  [0.35, 1.0, 0.45], // bacterium · green
  [0.85, 1.0, 0.5], // plant cell wall · yellow-green
  [0.5, 1.0, 0.15], // chloroplasts · lime
  [0.7, 0.6, 1.0], // central vacuole · lavender
]
export const HEX = COLORS.map((c) => '#' + c.map((v) => Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join(''))

export const R_CELL = 10
export const NUC = new THREE.Vector3(-1.2, 0.3, -0.5)
export const NUC_R = new THREE.Vector3(2.9, 2.6, 2.7)
export const GOLGI = new THREE.Vector3(3.6, 1.6, 1.0)
export const CENTRO = new THREE.Vector3(2.3, -1.1, 1.7)
/** the bacterium beside the cell (its points are local; the shader places it) */
export const BACT_HOME = new THREE.Vector3(15.2, -1.8, 4.5)
/** the cubes of Figure 4.6 */
export const CUBES_C = new THREE.Vector3(-34, 0, 0)

/* the plant cell: a rounded box, a central vacuole, the nucleus pushed aside */
export const BOX = new THREE.Vector3(13.5, 10.5, 9.5)
const BOX_E = 6
export const VAC_C = new THREE.Vector3(2.0, -1.0, 0)
export const VAC_R = new THREE.Vector3(9.5, 6.8, 6.0)
const VAC_E = 4
export const PNUC = new THREE.Vector3(-9.4, 6.6, 1.5)
export const PGOLGI = new THREE.Vector3(-4.0, 8.6, -1.5)

/* the centrifuge: four tubes in a row */
export const TUBE = { R: 2.4, y0: -4.0, y1: 8.0, xs: [-10.5, -3.5, 3.5, 10.5] }

/* anchors for the in-place labels */
export const ANCHORS: Record<string, THREE.Vector3> = {}

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
const superR = (d: THREE.Vector3, R: THREE.Vector3, e: number) => 1 / Math.pow(Math.pow(Math.abs(d.x / R.x), e) + Math.pow(Math.abs(d.y / R.y), e) + Math.pow(Math.abs(d.z / R.z), e), 1 / e)
const inBox = (p: THREE.Vector3) => Math.pow(Math.abs(p.x / BOX.x), BOX_E) + Math.pow(Math.abs(p.y / BOX.y), BOX_E) + Math.pow(Math.abs(p.z / BOX.z), BOX_E) < 1
const inVac = (p: THREE.Vector3, m = 0) =>
  Math.pow(Math.abs((p.x - VAC_C.x) / (VAC_R.x + m)), VAC_E) + Math.pow(Math.abs((p.y - VAC_C.y) / (VAC_R.y + m)), VAC_E) + Math.pow(Math.abs((p.z - VAC_C.z) / (VAC_R.z + m)), VAC_E) < 1

/** a point in the plant cell's thin layer of cytoplasm, between vacuole and membrane, in the direction of p */
const _d = new THREE.Vector3()
const _q = new THREE.Vector3()
function toLayer(p: THREE.Vector3, f: number, out = new THREE.Vector3()) {
  _d.copy(p).sub(VAC_C)
  if (_d.lengthSq() < 1e-6) _d.set(1, 0, 0)
  _d.normalize()
  const rv = superR(_d, VAC_R, VAC_E)
  // the membrane along the same ray: bisection
  let lo = rv, hi = 40
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2
    _q.copy(VAC_C).addScaledVector(_d, m)
    if (inBox(_q)) lo = m
    else hi = m
  }
  const r = rv + 0.35 + (lo - 0.3 - rv - 0.35) * f
  return out.copy(VAC_C).addScaledVector(_d, r)
}

export function buildCell() {
  const r = rng(11)
  const pos = new Float32Array(N * 3)
  const info = new Float32Array(N * 4) // tag, seed, a, b
  const aux = new Float32Array(N * 3)
  const plant = new Float32Array(N * 3)
  let n = 0
  const put = (x: number, y: number, z: number, tag: number, a = 0, b = 0) => {
    if (n >= N) return false
    pos[n * 3] = x
    pos[n * 3 + 1] = y
    pos[n * 3 + 2] = z
    info[n * 4] = tag
    info[n * 4 + 1] = r()
    info[n * 4 + 2] = a
    info[n * 4 + 3] = b
    n++
    return true
  }
  const setPlant = (i: number, v: THREE.Vector3) => {
    plant[i * 3] = v.x
    plant[i * 3 + 1] = v.y
    plant[i * 3 + 2] = v.z
  }
  const setAux = (i: number, v: THREE.Vector3) => {
    aux[i * 3] = v.x
    aux[i * 3 + 1] = v.y
    aux[i * 3 + 2] = v.z
  }
  const v = new THREE.Vector3()
  const dir = () => {
    const u = r() * 2 - 1
    const t = r() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    return v.set(s * Math.cos(t), u, s * Math.sin(t))
  }
  const gauss = () => (r() + r() + r() - 1.5) * 0.8
  const nucDir = GOLGI.clone().sub(NUC).normalize()
  const nucN = (p: THREE.Vector3) => Math.hypot((p.x - NUC.x) / NUC_R.x, (p.y - NUC.y) / NUC_R.y, (p.z - NUC.z) / NUC_R.z)
  /* rigid bodies keep their shape in the plant cell: [first index, count, animal centre, plant centre, scale] */
  const bodies: [number, number, THREE.Vector3, THREE.Vector3, number][] = []
  const body = (from: number, c: THREE.Vector3, pc: THREE.Vector3, s = 1) => bodies.push([from, n - from, c.clone(), pc.clone(), s])

  /* ---- nucleus: double envelope with pores, the lamina beneath, chromatin, a nucleolus ---- */
  const n0 = n
  const pores: THREE.Vector3[] = []
  for (let i = 0; i < 70; i++) pores.push(dir().clone())
  for (let i = 0; i < 21000; i++) {
    const d = dir()
    const s = r() < 0.5 ? 1.0 : 1.05
    const pore = pores.find((q) => q.dot(d) > 0.998)
    if (pore) {
      const p = pore
      const t = new THREE.Vector3().crossVectors(p, Math.abs(p.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize()
      const b = new THREE.Vector3().crossVectors(p, t)
      const a = r() * Math.PI * 2
      const q = p.clone().multiplyScalar(1.025).addScaledVector(t, Math.cos(a) * 0.04).addScaledVector(b, Math.sin(a) * 0.04)
      put(NUC.x + q.x * NUC_R.x, NUC.y + q.y * NUC_R.y, NUC.z + q.z * NUC_R.z, T.NE, 1)
      continue
    }
    put(NUC.x + d.x * NUC_R.x * s, NUC.y + d.y * NUC_R.y * s, NUC.z + d.z * NUC_R.z * s, T.NE)
  }
  ANCHORS.pore = NUC.clone().add(new THREE.Vector3(pores[3].x * NUC_R.x, pores[3].y * NUC_R.y, pores[3].z * NUC_R.z).multiplyScalar(1.03))
  ANCHORS.nucleus = NUC.clone().add(new THREE.Vector3(-0.6, NUC_R.y * 1.04, 0.5))
  ANCHORS.envelope = NUC.clone().add(new THREE.Vector3(-NUC_R.x * 0.9, -NUC_R.y * 0.5, NUC_R.z * 0.2))
  for (let i = 0; i < 2600; i++) {
    const d = dir()
    put(NUC.x + d.x * NUC_R.x * 0.975, NUC.y + d.y * NUC_R.y * 0.975, NUC.z + d.z * NUC_R.z * 0.975, T.IF, 0.5)
  }
  const nucleolus = NUC.clone().add(new THREE.Vector3(0.7, 0.55, 0.4))
  ANCHORS.nucleolus = nucleolus.clone()
  for (let i = 0; i < 12000; i++) {
    if (i < 3800) {
      const d = dir()
      const rr = 0.85 * Math.cbrt(r())
      put(nucleolus.x + d.x * rr, nucleolus.y + d.y * rr, nucleolus.z + d.z * rr, T.CHROM, 1)
    } else {
      const d = dir().multiplyScalar(0.07)
      const c = new THREE.Vector3(gauss() * 1.7, gauss() * 1.5, gauss() * 1.55)
      c.multiplyScalar(Math.min(1, 0.93 / Math.max(0.01, Math.hypot(c.x / NUC_R.x, c.y / NUC_R.y, c.z / NUC_R.z))))
      put(NUC.x + c.x + d.x, NUC.y + c.y + d.y, NUC.z + c.z + d.z, T.CHROM)
    }
  }
  ANCHORS.chromatin = NUC.clone().add(new THREE.Vector3(-1.1, -0.6, 1.2))
  body(n0, NUC, PNUC, 0.8)

  /* ---- rough ER: sacs wrapping the nucleus, continuous with its outer membrane ---- */
  const nR = n
  const sheets = [1.2, 1.4, 1.6, 1.8]
  let rer = 0
  while (rer < 30000) {
    const d = dir()
    const k = Math.floor(r() * sheets.length)
    const s = sheets[k] + 0.03 * Math.sin(d.x * 9 + k) * Math.cos(d.z * 7)
    const patch = Math.sin(d.x * 5.1 + k * 1.7) * Math.sin(d.y * 4.3 - k) * Math.sin(d.z * 5.7 + k * 0.6)
    if (patch < -0.12 || d.dot(nucDir) > 0.5) continue
    const layer = r() < 0.5 ? -0.026 : 0.026
    const rib = r() < 0.17
    const ss = s + layer + (rib ? 0.05 * Math.sign(layer) : 0)
    const x = NUC.x + d.x * NUC_R.x * ss
    const y = NUC.y + d.y * NUC_R.y * ss
    const z = NUC.z + d.z * NUC_R.z * ss
    if (Math.hypot(x, y, z) > R_CELL - 0.6) continue
    put(x, y, z, T.RER, rib ? 1 : 0, k)
    rer++
  }
  ANCHORS.rer = NUC.clone().add(new THREE.Vector3(-NUC_R.x * 1.55, -0.5, 1.6))
  body(nR, NUC, PNUC, 0.8)

  /* ---- smooth ER: a tubular net further out ---- */
  const nS = n
  for (let t = 0; t < 24; t++) {
    const a = dir().clone().multiplyScalar(-1).lerp(nucDir.clone().multiplyScalar(-1), 0.4).normalize()
    const p0 = NUC.clone().addScaledVector(a, 5.4 + r() * 1.2)
    const b = dir().clone().multiplyScalar(2.4)
    const c = dir().clone().multiplyScalar(2.0)
    for (let i = 0; i < 480; i++) {
      const s = i / 480
      const p = p0.clone().addScaledVector(b, Math.sin(s * 3.1)).addScaledVector(c, s * s - s)
      if (p.length() > R_CELL - 0.5 || nucN(p) < 1.9) continue
      const j = dir().multiplyScalar(0.06)
      put(p.x + j.x, p.y + j.y, p.z + j.z, T.SER, t / 24, s)
    }
    if (t === 5) ANCHORS.ser = p0.clone()
  }
  const nSe = n

  /* ---- Golgi: a stack of curved cisternae, cis face toward the nucleus ---- */
  const nG = n
  const gz = nucDir.clone()
  const gx = new THREE.Vector3().crossVectors(gz, new THREE.Vector3(0, 1, 0)).normalize()
  const gy = new THREE.Vector3().crossVectors(gx, gz)
  const cis = 6
  for (let c = 0; c < cis; c++) {
    const rad = 1.9 - c * 0.13 + (c === 0 ? 0.1 : 0)
    for (let i = 0; i < 2700; i++) {
      const a = r() * Math.PI * 2
      const rr = rad * Math.sqrt(r())
      const x = Math.cos(a) * rr
      const y = Math.sin(a) * rr * 0.55
      const bow = -0.22 * (x * x + y * y)
      const rim = rr / rad > 0.9 ? 0.065 : 0.026
      const lay = (r() < 0.5 ? -1 : 1) * rim
      const p = GOLGI.clone().addScaledVector(gx, x).addScaledVector(gy, y).addScaledVector(gz, c * 0.28 + bow + lay)
      put(p.x, p.y, p.z, T.GOLGI, c / (cis - 1))
    }
  }
  for (let b = 0; b < 24; b++) {
    const a = r() * Math.PI * 2
    const c = GOLGI.clone().addScaledVector(gx, Math.cos(a) * 2.0).addScaledVector(gy, Math.sin(a) * 1.15).addScaledVector(gz, r() * 1.5)
    for (let i = 0; i < 80; i++) {
      const d = dir().multiplyScalar(0.13)
      put(c.x + d.x, c.y + d.y, c.z + d.z, T.GOLGI, 0.5)
    }
  }
  ANCHORS.golgi = GOLGI.clone().addScaledVector(gy, 1.2).addScaledVector(gz, 0.9)
  ANCHORS.cis = GOLGI.clone().addScaledVector(gx, -1.9)
  ANCHORS.trans = GOLGI.clone().addScaledVector(gx, 1.7).addScaledVector(gz, 1.4)
  body(nG, GOLGI, PGOLGI, 0.85)

  /* ---- mitochondria: capsules with cristae ---- */
  const mitos: THREE.Vector3[] = []
  let guard = 0
  while (mitos.length < 13 && guard++ < 800) {
    const c = dir().clone().multiplyScalar(4.8 + r() * 3.4)
    if (c.distanceTo(GOLGI) < 2.9 || nucN(c) < 1.95 || mitos.some((m) => m.distanceTo(c) < 2.4)) continue
    mitos.push(c)
  }
  mitos.forEach((c, id) => {
    const from = n
    const ax = dir().clone()
    const tx = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0.3, 1, 0.1)).normalize()
    const ty = new THREE.Vector3().crossVectors(ax, tx)
    const Lm = 0.8 + r() * 0.7
    const R = 0.4
    for (let i = 0; i < 1700; i++) {
      if (i < 980) {
        const s = (r() * 2 - 1) * (Lm + R)
        const a = r() * Math.PI * 2
        const cap = Math.abs(s) > Lm ? Math.sqrt(Math.max(0, 1 - ((Math.abs(s) - Lm) / R) ** 2)) : 1
        const rr = R * cap * (r() < 0.5 ? 1 : 0.9)
        const p = c.clone().addScaledVector(ax, s).addScaledVector(tx, Math.cos(a) * rr).addScaledVector(ty, Math.sin(a) * rr)
        put(p.x, p.y, p.z, T.MITO, id)
      } else {
        const k = Math.floor(r() * 7)
        const s = -Lm + ((k + 0.5) / 7) * 2 * Lm
        const a = r() * Math.PI * 2
        const rr = R * 0.86 * Math.sqrt(r())
        const side = Math.cos(a) * rr
        if (side > R * 0.35) continue
        const p = c.clone().addScaledVector(ax, s + 0.05 * Math.sin(a * 3)).addScaledVector(tx, side).addScaledVector(ty, Math.sin(a) * rr)
        put(p.x, p.y, p.z, T.MITO, id)
      }
    }
    body(from, c, toLayer(c, 0.5), 1)
  })
  ANCHORS.mito = mitos[0].clone()

  /* ---- lysosomes: dense sacs of enzymes (animal only) ---- */
  const lysos: THREE.Vector3[] = []
  for (let i = 0; i < 11; i++) {
    const c = dir().clone().multiplyScalar(4.2 + r() * 4.0)
    if (nucN(c) < 1.9 || c.distanceTo(GOLGI) < 2.2) {
      i--
      continue
    }
    lysos.push(c)
    const from = n
    const R = 0.26 + r() * 0.22
    for (let k = 0; k < 440; k++) {
      const d = dir().multiplyScalar(R * Math.cbrt(r()))
      put(c.x + d.x, c.y + d.y, c.z + d.z, T.LYSO, i)
    }
    body(from, c, toLayer(c, 0.5), 0.6)
  }
  ANCHORS.lyso = lysos[0].clone()

  /* ---- peroxisomes: single membrane, a crystalline core ---- */
  const peros: THREE.Vector3[] = []
  for (let i = 0; i < 9; i++) {
    const c = dir().clone().multiplyScalar(4.4 + r() * 3.6)
    if (nucN(c) < 1.9 || lysos.some((l) => l.distanceTo(c) < 1) || mitos.some((m) => m.distanceTo(c) < 1.2)) {
      i--
      continue
    }
    peros.push(c)
    const from = n
    const R = 0.3 + r() * 0.12
    for (let k = 0; k < 300; k++) {
      if (k < 200) {
        const d = dir().multiplyScalar(R)
        put(c.x + d.x, c.y + d.y, c.z + d.z, T.PEROX, 0)
      } else {
        // the core: a little crystal lattice of enzyme
        const g = 0.07
        const x = Math.round((r() - 0.5) * 3) * g, y = Math.round((r() - 0.5) * 3) * g, z = Math.round((r() - 0.5) * 3) * g
        put(c.x + x, c.y + y, c.z + z, T.PEROX, 1)
      }
    }
    body(from, c, toLayer(c, 0.55), 1)
  }
  ANCHORS.perox = peros[0].clone()

  /* ---- vesicles: pos holds the local offset; aux holds the membrane target ---- */
  const nv = 40
  for (let k = 0; k < nv; k++) {
    const end = nucDir.clone().add(dir().clone().multiplyScalar(0.75)).normalize().multiplyScalar(R_CELL * 0.985)
    const R = 0.16 + r() * 0.07
    if (k === 0) ANCHORS.ves0 = end.clone()
    for (let i = 0; i < 150; i++) {
      const d = dir().multiplyScalar(R)
      if (put(d.x, d.y, d.z, T.VES, k / nv, R)) setAux(n - 1, end)
    }
  }

  /* ---- centrosome: two centrioles of nine triplets, at right angles ---- */
  for (let i = 0; i < 9; i++) {
    for (const o of [0, 1]) {
      const a = (i / 9) * Math.PI * 2
      for (let k = 0; k < 40; k++) {
        const h = (r() - 0.5) * 0.45
        const x = Math.cos(a) * 0.11
        const y = Math.sin(a) * 0.11
        const p = o === 0 ? new THREE.Vector3(x, y, h) : new THREE.Vector3(h, x, y + 0.25)
        put(CENTRO.x + p.x, CENTRO.y + p.y, CENTRO.z + p.z, T.CENT)
      }
    }
  }
  ANCHORS.centrosome = CENTRO.clone()

  /* ---- microtubules radiate from the centrosome ---- */
  for (let m = 0; m < 76; m++) {
    const end = dir().clone().multiplyScalar(R_CELL * 0.95)
    const ctrl = CENTRO.clone().lerp(end, 0.5).add(dir().clone().multiplyScalar(1.4))
    const toN = ctrl.clone().sub(NUC)
    if (toN.length() < 4.4) ctrl.copy(NUC).addScaledVector(toN.normalize(), 4.6)
    const cnt = 200
    for (let i = 0; i < cnt; i++) {
      const s = i / cnt
      const a = CENTRO.clone().multiplyScalar((1 - s) * (1 - s)).addScaledVector(ctrl, 2 * s * (1 - s)).addScaledVector(end, s * s)
      if (nucN(a) < 1.1) continue
      const j = dir().multiplyScalar(0.025)
      put(a.x + j.x, a.y + j.y, a.z + j.z, T.MT, s, m / 76)
    }
    if (m === 6) ANCHORS.mt = CENTRO.clone().lerp(end, 0.62)
  }

  /* ---- actin: a dense cortex just beneath the membrane ---- */
  for (let f = 0; f < 600; f++) {
    const p0 = dir().clone().multiplyScalar(R_CELL * (0.93 + r() * 0.05))
    const t = new THREE.Vector3().crossVectors(p0, dir()).normalize()
    const Lf = 0.6 + r() * 2.0
    for (let i = 0; i < 20; i++) {
      const p = p0.clone().addScaledVector(t, ((i / 20) - 0.5) * Lf)
      p.setLength(R_CELL * 0.95 + (r() - 0.5) * 0.12)
      put(p.x, p.y, p.z, T.ACTIN)
    }
  }
  ANCHORS.actin = new THREE.Vector3(-6.6, -7.2, 1.2).setLength(R_CELL * 0.95)

  /* ---- intermediate filaments: long wavy ropes, nucleus → membrane (animal only) ---- */
  for (let f = 0; f < 40; f++) {
    const a = NUC.clone().add(dir().clone().multiplyScalar(3.3))
    const b = dir().clone().multiplyScalar(R_CELL * 0.94)
    const w = dir().clone().multiplyScalar(1.3)
    for (let i = 0; i < 210; i++) {
      const s = i / 210
      const p = a.clone().lerp(b, s).addScaledVector(w, Math.sin(s * 9 + f)).add(new THREE.Vector3(0, Math.sin(s * 13 + f * 2) * 0.3, 0))
      if (nucN(p) < 1.08 || p.length() > R_CELL * 0.96) continue
      put(p.x, p.y, p.z, T.IF, 0)
    }
    if (f === 2) ANCHORS.ifil = a.clone().lerp(b, 0.62)
  }

  /* ---- free ribosomes, some strung into polysomes ---- */
  for (let k = 0; k < 520; k++) {
    let c = dir().clone().multiplyScalar(3 + r() * 6.4)
    if (nucN(c) < 1.3) c = c.multiplyScalar(1.6)
    if (c.length() > R_CELL - 0.4) c.setLength(R_CELL - 0.6)
    const poly = r() < 0.5
    const axis = dir().clone()
    const tx = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0.2)).normalize()
    const ty = new THREE.Vector3().crossVectors(axis, tx)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      const p = poly ? c.clone().addScaledVector(tx, Math.cos(a) * 0.09).addScaledVector(ty, Math.sin(a) * 0.09).addScaledVector(axis, i * 0.025) : c.clone().add(dir().clone().multiplyScalar(0.25))
      put(p.x, p.y, p.z, T.RIBO)
    }
  }
  ANCHORS.ribo = new THREE.Vector3(1.5, -5.2, 3.6)

  /* ---- microvilli: fingers on one face of the cell ---- */
  const villiDir = new THREE.Vector3(-0.25, 0.92, 0.3).normalize()
  for (let k = 0; k < 230; k++) {
    let d: THREE.Vector3
    do d = dir().clone()
    while (d.dot(villiDir) < 0.86)
    for (let i = 0; i < 14; i++) {
      const s = i / 13
      const j = dir().multiplyScalar(0.05)
      put(d.x * R_CELL + j.x, d.y * R_CELL + j.y, d.z * R_CELL + j.z, T.VILLI, s, k)
      setAux(n - 1, d)
    }
  }
  ANCHORS.villi = villiDir.clone().multiplyScalar(R_CELL + 0.8)

  /* ---- a flagellum: one long whip (animal cells such as sperm) ---- */
  const flagDir = new THREE.Vector3(-0.85, -0.45, 0.28).normalize()
  for (let i = 0; i < 2400; i++) {
    const s = i / 2400
    put(0, 0, 0, T.FLAG, s, r())
    setAux(n - 1, flagDir)
  }
  ANCHORS.flag = flagDir.clone().multiplyScalar(R_CELL + 6)

  /* ---- the bacterium: a rod 2.4 µm long, local coordinates ---- */
  {
    const L = 1.0, R = 0.42
    const surf = (s: number, a: number, rr: number) => {
      const cap = Math.abs(s) > L ? Math.sqrt(Math.max(0, 1 - ((Math.abs(s) - L) / R) ** 2)) : 1
      return new THREE.Vector3(s, Math.cos(a) * rr * cap, Math.sin(a) * rr * cap)
    }
    for (let i = 0; i < 4200; i++) {
      const s = (r() * 2 - 1) * (L + R)
      const a = r() * Math.PI * 2
      const part = i % 2
      const p = surf(s, a, R * (part === 0 ? 1 : 0.94))
      put(p.x, p.y, p.z, T.BACT, part)
    }
    for (let i = 0; i < 1400; i++) {
      const s = (r() * 2 - 1) * (L + R + 0.15)
      const a = r() * Math.PI * 2
      const p = surf(s * 0.98, a, R + 0.12 + r() * 0.06)
      put(p.x, p.y, p.z, T.BACT, 2)
    }
    // nucleoid: a tangled loop of DNA in the middle, not membrane-bound
    const w = new THREE.Vector3()
    for (let i = 0; i < 2600; i++) {
      if (i % 260 === 0) w.set((r() - 0.5) * 1.0, (r() - 0.5) * 0.25, (r() - 0.5) * 0.25)
      w.add(dir().clone().multiplyScalar(0.03))
      w.x = Math.max(-0.75, Math.min(0.75, w.x))
      w.y = Math.max(-0.22, Math.min(0.22, w.y))
      w.z = Math.max(-0.22, Math.min(0.22, w.z))
      put(w.x, w.y, w.z, T.BACT, 3)
    }
    for (let i = 0; i < 1600; i++) {
      const s = (r() * 2 - 1) * L * 1.1
      const a = r() * Math.PI * 2
      const rr = R * 0.85 * Math.sqrt(r())
      put(s, Math.cos(a) * rr, Math.sin(a) * rr, T.BACT, 4)
    }
    for (let k = 0; k < 4; k++) for (let i = 0; i < 420; i++) put(0, 0, 0, T.BACT, 5, k + i / 420)
    for (let k = 0; k < 90; k++) {
      const s = (r() * 2 - 1) * (L + R * 0.5)
      const a = r() * Math.PI * 2
      const base = surf(s, a, R)
      const nrm = new THREE.Vector3(0, Math.cos(a), Math.sin(a))
      for (let i = 0; i < 9; i++) {
        const p = base.clone().addScaledVector(nrm, 0.04 + (i / 8) * 0.32)
        put(p.x, p.y, p.z, T.BACT, 6)
      }
    }
  }
  ANCHORS.bact = BACT_HOME.clone().add(new THREE.Vector3(0, 0.8, 0))

  /* ---- plant only: the cell wall, with plasmodesmata through it ---- */
  const pd: THREE.Vector3[] = []
  for (let i = 0; i < 16; i++) {
    const side = i < 8 ? 1 : -1
    pd.push(new THREE.Vector3(side * BOX.x, (r() - 0.5) * BOX.y * 1.2, (r() - 0.5) * BOX.z * 1.2))
  }
  for (let i = 0; i < 19000; i++) {
    const d = dir().clone()
    const rb = superR(d, BOX, BOX_E)
    const p = d.clone().multiplyScalar(rb)
    const near = pd.find((q) => Math.hypot(q.y - p.y, q.z - p.z) < 0.22 && Math.sign(q.x) === Math.sign(p.x) && Math.abs(p.x) > BOX.x * 0.9)
    if (near) continue
    const t = 0.18 + r() * 0.45
    const q = d.clone().multiplyScalar(rb + t)
    put(q.x, q.y, q.z, T.WALL, 0)
    setPlant(n - 1, q)
  }
  for (const q of pd) {
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2
      const x = Math.sign(q.x) * (BOX.x - 0.1 + r() * 0.9)
      const p = new THREE.Vector3(x, q.y + Math.cos(a) * 0.12, q.z + Math.sin(a) * 0.12)
      put(p.x, p.y, p.z, T.WALL, 1)
      setPlant(n - 1, p)
    }
  }
  ANCHORS.wall = new THREE.Vector3(0, BOX.y + 0.4, BOX.z * 0.4)
  ANCHORS.plasmod = pd[0].clone().add(new THREE.Vector3(0.4, 0, 0))

  /* ---- plant only: the central vacuole (tonoplast and a little sap) ---- */
  for (let i = 0; i < 11000; i++) {
    const d = dir().clone()
    const rv = superR(d, VAC_R, VAC_E)
    const sap = i > 9500
    const q = VAC_C.clone().addScaledVector(d, sap ? rv * Math.cbrt(r()) * 0.95 : rv)
    put(q.x, q.y, q.z, T.VAC, sap ? 1 : 0)
    setPlant(n - 1, q)
  }
  ANCHORS.vac = VAC_C.clone().add(new THREE.Vector3(2, VAC_R.y * 0.6, VAC_R.z * 0.6))

  /* ---- plant only: chloroplasts, lens-shaped, with grana ---- */
  const chl: THREE.Vector3[] = []
  guard = 0
  while (chl.length < 16 && guard++ < 2000) {
    const c = toLayer(dir().clone().multiplyScalar(5), 0.5)
    if (chl.some((q) => q.distanceTo(c) < 3.0) || c.distanceTo(PNUC) < 3.6 || c.distanceTo(PGOLGI) < 2.6) continue
    chl.push(c)
  }
  chl.forEach((c, id) => {
    const nrm = c.clone().sub(VAC_C).normalize()
    const tx = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(0.2, 0.1, 1)).normalize()
    const ty = new THREE.Vector3().crossVectors(nrm, tx)
    const A = 1.9, B = 1.25, C = 0.6
    for (let i = 0; i < 900; i++) {
      let p: THREE.Vector3
      if (i < 380) {
        const d = dir().clone()
        const s = i % 2 ? 1 : 0.94
        p = new THREE.Vector3(d.x * A * s, d.y * B * s, d.z * C * s)
      } else {
        const g = Math.floor(r() * 9)
        const gx2 = Math.cos(g * 2.4) * 1.1 * Math.sqrt((g + 0.5) / 9)
        const gy2 = Math.sin(g * 2.4) * 0.75 * Math.sqrt((g + 0.5) / 9)
        const a = r() * Math.PI * 2
        const rr = 0.22 * Math.sqrt(r())
        const disc = Math.floor(r() * 6)
        p = new THREE.Vector3(gx2 + Math.cos(a) * rr, gy2 + Math.sin(a) * rr, (disc - 2.5) * 0.07)
      }
      const q = c.clone().addScaledVector(tx, p.x).addScaledVector(ty, p.y).addScaledVector(nrm, p.z)
      put(q.x, q.y, q.z, T.CHLORO, i < 380 ? 0 : 1, id)
      setPlant(n - 1, q)
    }
  })
  ANCHORS.chloro = chl[0].clone().add(new THREE.Vector3(0, 0.9, 0))

  /* ---- the plasma membrane: most of what is left, minus a little cytosol haze ---- */
  const rest = N - n - 14000
  const nPM = n
  for (let i = 0; i < rest; i++) {
    const d = dir()
    const w = 1 + 0.012 * Math.sin(d.x * 7) * Math.sin(d.y * 6 + 1) * Math.sin(d.z * 8)
    const rr = R_CELL * w * (1 + (r() - 0.5) * 0.004)
    put(d.x * rr, d.y * rr, d.z * rr, T.PM)
  }
  const nPMe = n
  ANCHORS.pm = new THREE.Vector3(9.55, 1.9, 3.2).setLength(R_CELL)
  const nH = n
  while (n < N) {
    const d = dir().multiplyScalar(R_CELL * 0.92 * Math.cbrt(r()))
    if (nucN(d) < 1.1) continue
    put(d.x, d.y, d.z, T.HAZE)
  }

  /* ---- plant homes for everything that was not placed explicitly ---- */
  const tmp = new THREE.Vector3()
  const hasPlant = new Uint8Array(N)
  for (const [from, cnt, c, pc, s] of bodies) {
    for (let i = from; i < from + cnt; i++) {
      tmp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(c).multiplyScalar(s).add(pc)
      // rough ER pressed against the vacuole is squeezed into the cytoplasm
      if (inVac(tmp, 0.3)) toLayer(tmp, 0.25, tmp)
      setPlant(i, tmp)
      hasPlant[i] = 1
    }
  }
  for (let i = 0; i < N; i++) {
    if (hasPlant[i]) continue
    const tag = info[i * 4]
    if (tag === T.WALL || tag === T.VAC || tag === T.CHLORO) continue
    tmp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
    if (tag === T.PM) {
      const d = tmp.clone().normalize()
      setPlant(i, d.multiplyScalar(superR(d, BOX, BOX_E) - 0.05))
    } else if (tag === T.ACTIN) {
      const d = tmp.clone().normalize()
      setPlant(i, d.multiplyScalar(superR(d, BOX, BOX_E) - 0.35))
    } else if (tag === T.SER || tag === T.HAZE || tag === T.MT || tag === T.IF || tag === T.RIBO || tag === T.CENT) {
      setPlant(i, toLayer(tmp, 0.15 + 0.7 * ((i * 0.618) % 1)))
    } else {
      setPlant(i, tmp)
    }
  }
  void nS
  void nSe
  void nPM
  void nPMe
  void nH

  /* ---- the flow map: a flat home for every point (local µm, centred on DIAG) ---- */
  const map = new Float32Array(N * 3)
  const NR = 2.6
  const NC = [-5.6, 0.2]
  const EA = 10, EB = 6.8
  const fr = (x: number) => x - Math.floor(x)
  const MITO_SLOTS: [number, number, number][] = [
    [-8.0, 2.3, 1.1], [-7.7, -2.5, -1.1], [-5.3, 4.7, 0.35], [-5.5, -4.5, -0.35], [-1.8, 5.5, 0.05], [1.9, 5.6, -0.05], [5.5, 4.9, -0.35],
    [8.3, 2.9, -1.0], [8.5, -2.6, 1.0], [2.6, -5.9, 0.05], [-9.1, 0, 1.57], [6.8, 2.8, -0.6], [-0.2, 3.8, 0.4],
  ]
  const LYSO_AT = [[4.4, -4.4], [5.7, -5.1], [6.9, -4.2]]
  const BUDS = [[4.55, 2.05], [4.75, -1.5], [4.95, 0.4], [1.75, 2.45], [1.65, -2.25], [4.3, -2.45]]
  const ARROWS = [
    [[-0.5, 0.9], [0.45, 1.25], [1.35, 0.9]],
    [[4.7, 0.9], [7.2, 1.6], [9.35, 0.9]],
    [[4.2, -2.35], [4.6, -3.1], [5.1, -3.75]],
  ]
  const bez2 = (P: number[][], t: number) => [
    (1 - t) * (1 - t) * P[0][0] + 2 * t * (1 - t) * P[1][0] + t * t * P[2][0],
    (1 - t) * (1 - t) * P[0][1] + 2 * t * (1 - t) * P[1][1] + t * t * P[2][1],
  ]
  for (let i = 0; i < N; i++) {
    const tag = info[i * 4]
    const seed = info[i * 4 + 1]
    const A = info[i * 4 + 2]
    const B = info[i * 4 + 3]
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const side = fr(seed * 13.7) > 0.5 ? 1 : -1
    let mx = x * 0.5, my = y * 0.5
    if (tag === T.PM || tag === T.ACTIN) {
      const th = Math.atan2(y, x)
      const k = tag === T.PM ? 1 + side * 0.008 : 0.955
      mx = EA * k * Math.cos(th)
      my = EB * k * Math.sin(th) * (1 + (tag === T.PM ? side * 0.004 : 0))
    } else if (tag === T.NE || (tag === T.IF && A === 0.5)) {
      const q = [(x - NUC.x) / NUC_R.x, (y - NUC.y) / NUC_R.y, (z - NUC.z) / NUC_R.z]
      const th = Math.atan2(q[1], q[0])
      const rr = tag === T.IF ? NR * 0.93 : Math.hypot(q[0], q[1], q[2]) > 1.03 ? NR * 1.07 : NR
      mx = NC[0] + rr * Math.cos(th)
      my = NC[1] + rr * Math.sin(th)
    } else if (tag === T.CHROM) {
      mx = NC[0] + ((x - NUC.x) / NUC_R.x) * NR * 0.9
      my = NC[1] + ((y - NUC.y) / NUC_R.y) * NR * 0.9
    } else if (tag === T.RER) {
      const phi = (fr(seed * 7.31) - 0.5) * 2 * 1.19
      const R = NR + 0.65 + B * 0.5 + 0.05 * Math.sin(phi * 9 + B) + side * 0.07 + (A === 1 ? 0.17 * side : 0)
      mx = NC[0] + R * Math.cos(phi)
      my = NC[1] + R * Math.sin(phi)
    } else if (tag === T.SER) {
      const t = Math.round(A * 24)
      mx = -3.4 + (t % 3) * 0.3 + B * 3.9
      my = -4.35 - (t % 4) * 0.38 + 0.18 * Math.sin(B * 11 + t * 1.7) + side * 0.04
    } else if (tag === T.GOLGI) {
      if (Math.abs(A - 0.5) < 1e-3) {
        const b = BUDS[Math.floor(fr(seed * 3.3) * 6)]
        const a = fr(seed * 17.1) * Math.PI * 2
        mx = b[0] + Math.cos(a) * 0.14
        my = b[1] + Math.sin(a) * 0.14
      } else {
        const c = Math.round(A * 5)
        const Y = 2.3 * (1 - 0.07 * c)
        const yy = (fr(seed * 5.7) * 2 - 1) * Y
        const rim = Math.abs(yy) / Y > 0.9 ? 0.1 : 0.05
        mx = 2.0 + c * 0.42 - 0.45 * (1 - (yy / Y) ** 2) + side * rim
        my = yy
      }
    } else if (tag === T.MITO) {
      const [cx, cy, ang] = MITO_SLOTS[Math.round(A) % MITO_SLOTS.length]
      const Lm = 0.75, R = 0.42
      let u = 0, w = 0
      if (fr(seed * 7.7) < 0.62) {
        const s = fr(seed * 3.1) * (2 * Lm + Math.PI * R) - Lm
        if (s <= Lm) ((u = s), (w = side * R))
        else {
          const a = (s - Lm) / R
          const cap = fr(seed * 5.3) > 0.5 ? 1 : -1
          u = cap * (Lm + Math.sin(a) * R)
          w = Math.cos(a) * R
        }
      } else {
        const k = Math.floor(fr(seed * 4.9) * 5)
        u = -0.6 + k * 0.3
        w = (k % 2 ? 1 : -1) * (R - fr(seed * 8.3) * R * 1.3)
      }
      mx = cx + u * Math.cos(ang) - w * Math.sin(ang)
      my = cy + u * Math.sin(ang) + w * Math.cos(ang)
    } else if (tag === T.LYSO) {
      const c = lysos[A]
      const at = LYSO_AT[A % 3]
      mx = at[0] + (x - c.x) * 0.8
      my = at[1] + (y - c.y) * 0.8
    } else if (tag === T.MT) {
      const m = Math.round(B * 76)
      const P = ARROWS[m % 3]
      if (A < 0.88) {
        const [bx, by] = bez2(P, A / 0.88)
        const [bx2, by2] = bez2(P, Math.min(1, A / 0.88 + 0.01))
        const dx = bx2 - bx, dy = by2 - by, l = Math.hypot(dx, dy) || 1
        const off = (fr(m * 0.618) - 0.5) * 0.09
        mx = bx - (dy / l) * off
        my = by + (dx / l) * off
      } else {
        const u = (A - 0.88) / 0.12
        const [ex, ey] = P[2]
        const [px, py] = bez2(P, 0.96)
        const dx = ex - px, dy = ey - py, l = Math.hypot(dx, dy) || 1
        const s2 = fr(seed * 3.9) > 0.5 ? 1 : -1
        mx = ex - (dx / l) * u * 0.42 - (dy / l) * u * 0.3 * s2
        my = ey - (dy / l) * u * 0.42 + (dx / l) * u * 0.3 * s2
      }
    }
    map[i * 3] = mx
    map[i * 3 + 1] = my
    map[i * 3 + 2] = 0
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4))
  g.setAttribute('aAux', new THREE.BufferAttribute(aux, 3))
  g.setAttribute('aMap', new THREE.BufferAttribute(map, 3))
  g.setAttribute('aPlant', new THREE.BufferAttribute(plant, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200)

  const colors = COLORS.map((c) => new THREE.Vector3(...c))
  const PITS = [
    [0.2, -0.9, 0.4], [-0.8, 0.3, 0.5], [0.6, 0.2, 0.78], [-0.4, -0.5, 0.75], [0.9, -0.3, -0.1], [-0.3, 0.9, -0.3], [-0.7, -0.6, -0.2],
  ].map((q) => new THREE.Vector3(...q).normalize())
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime,
      uCol: { value: colors },
      uOrg: { value: 1 },
      uCyto: { value: 0.12 },
      uVes: { value: 0 },
      uMem: { value: 0.45 },
      uFocus: { value: 30 },
      uPx: { value: 1 },
      uRayO: U.uRayO,
      uRayD: U.uRayD,
      uMouseF: U.uMouseF,
      uAlpha: { value: 1 },
      uGolgi: { value: GOLGI.clone() },
      uNuc: { value: NUC.clone() },
      uNucDir: { value: nucDir },
      uMap: { value: 0 },
      uDiagC: { value: new THREE.Vector2(0, 0) },
      uPlant: { value: 0 },
      uBact: { value: 0 },
      uBactPos: { value: BACT_HOME.clone() },
      uBactRot: { value: 0.35 },
      uDigest: { value: 0 },
      uVilli: { value: 0 },
      uFlag: { value: 0 },
      uFlat: { value: 0 },
      uHomog: { value: 0 },
      uFrac: { value: 0 },
      uSwing: { value: new THREE.Vector4() },
      uTubeX: { value: new THREE.Vector4(...TUBE.xs) },
      uMacro: { value: 0 },
      uEngulf: { value: 0 },
      uLive: { value: 0 },
      uPits: { value: PITS },
      uHiMask: { value: 0 },
      uHiAmt: { value: 0 },
      uMode: { value: 0 },
      uView: { value: new THREE.Vector3(0, 0, 1) },
      uFocusP: { value: new THREE.Vector3() },
      uMapHi: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${HASH}${NOISE}
      uniform float uTime, uOrg, uCyto, uVes, uMem, uFocus, uPx, uMouseF, uAlpha;
      uniform float uMap, uPlant, uBact, uBactRot, uDigest, uVilli, uFlag, uFlat, uHomog, uFrac, uMacro, uEngulf, uLive, uHiAmt, uMode, uMapHi;
      uniform int uHiMask;
      uniform vec3 uCol[${NTAG}];
      uniform vec3 uRayO, uRayD, uGolgi, uNuc, uNucDir, uBactPos, uView, uFocusP;
      uniform vec3 uPits[7];
      uniform vec4 uSwing, uTubeX;
      uniform vec2 uDiagC;
      in vec4 aInfo;
      in vec3 aAux;
      in vec3 aMap;
      in vec3 aPlant;
      out vec3 vCol;
      out float vA;
      out float vBlur;
      out float vHard;
      out float vLin;
      const float PI = 3.14159265;
      const float TR = ${TUBE.R.toFixed(2)}, TY0 = ${TUBE.y0.toFixed(2)}, TY1 = ${TUBE.y1.toFixed(2)};

      vec3 bez(vec3 a, vec3 b, vec3 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }
      vec2 bez2(vec2 a, vec2 b, vec2 c, float t){ return mix(mix(a,b,t), mix(b,c,t), t); }
      float ss(float a, float b, float x){ return smoothstep(a, b, x); }

      /* the same journey, drawn flat on the map */
      vec2 route2D(float k, float t){
        float j = sin(k * 40.0) * 0.25;
        vec2 exitER = vec2(-0.4, 0.9 + j);
        vec2 cisF = vec2(1.5, 0.9 + j * 0.8);
        vec2 transF = vec2(4.6, 0.3 + j * 2.0);
        bool toLyso = fract(k * 11.0) < 0.25;
        vec2 end = toLyso ? vec2(5.5, -4.1) + vec2(j, j * 0.5) : vec2(9.55, 0.9 + j * 2.4);
        vec2 c;
        if (t < 0.3) c = mix(exitER, cisF, smoothstep(0.0, 0.3, t));
        else if (t < 0.5) c = mix(cisF, transF, smoothstep(0.3, 0.5, t));
        else c = bez2(transF, mix(transF, end, 0.5) + vec2(0.0, toLyso ? -0.3 : 0.5), end, smoothstep(0.5, 0.97, t));
        return uDiagC + c;
      }

      /* the centrifuge: which pellet a structure ends up in */
      int fraction(int tag, float A){
        if (tag == 1 || tag == 2 || (tag == 11 && A > 0.4 && A < 0.6)) return 0;   // nuclei
        if (tag == 6) return 1;                                                   // mitochondria
        if (tag == 15) return 3;                                                  // free ribosomes
        if (tag == 0 || tag == 3 || tag == 4 || tag == 5 || tag == 7 || tag == 8 || tag == 14 || tag == 16) return 2; // membranes (rough ER keeps its ribosomes)
        return 4;                                                                 // the soluble rest: cytosol
      }
      vec3 tubeBase(int t){ return vec3(t == 0 ? uTubeX.x : t == 1 ? uTubeX.y : t == 2 ? uTubeX.z : uTubeX.w, 0.0, 0.0); }
      float swingOf(int t){ return t == 0 ? uSwing.x : t == 1 ? uSwing.y : t == 2 ? uSwing.z : uSwing.w; }
      /* a tube swings out on its rotor arm: bottom outward, about a pivot above it */
      vec3 swung(vec3 local, int t){
        float a = swingOf(t) * 1.5707963;
        vec3 piv = vec3(0.0, TY1 + 0.6, 0.0);
        vec3 q = local - piv;
        q.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * q.xy;
        return tubeBase(t) + piv + q;
      }
      vec3 suspended(float seed, float fill){
        vec3 h = hash33(vec3(seed * 71.0, seed * 13.0, 5.0));
        float a = h.x * 6.2832, rr = sqrt(h.y) * TR * 0.86;
        float y = mix(TY0 - TR * 0.55, mix(TY0, TY1 - 1.2, fill), h.z);
        vec3 p = vec3(cos(a) * rr, y, sin(a) * rr);
        if (p.y < TY0) { float m = sqrt(max(TR * TR * 0.72 - (p.y - TY0) * (p.y - TY0), 0.0)); p.xz = normalize(p.xz + 1e-4) * min(length(p.xz), m); }
        p += vec3(gnoise(vec3(seed * 40.0, uTime * 0.3, 1.0)), gnoise(vec3(seed * 40.0, uTime * 0.3, 7.0)), gnoise(vec3(seed * 40.0, uTime * 0.3, 13.0))) * 0.12;
        return p;
      }
      vec3 pellet(float seed, int c){
        vec3 h = hash33(vec3(seed * 53.0, 3.0, seed * 7.0));
        float hp = c == 0 ? 1.0 : c == 1 ? 0.85 : c == 2 ? 0.95 : 0.45;
        float y = TY0 - TR + 0.08 + h.z * hp;
        float m = sqrt(max(TR * TR - (y - TY0) * (y - TY0), 0.0)) * 0.92;
        float a = h.x * 6.2832;
        return vec3(cos(a), 0.0, sin(a)) * sqrt(h.y) * m + vec3(0.0, y, 0.0);
      }

      void main(){
        int tag = int(aInfo.x + 0.5);
        float seed = aInfo.y;
        vec3 p = position;
        float gain = 1.0;
        float size = 1.0;
        vec3 col = uCol[tag];
        vec3 pMap = aMap;
        vec3 pPlant = aPlant;
        float plantOnly = (tag == 19 || tag == 20 || tag == 21) ? 1.0 : 0.0;
        float animalOnly = (tag == 7 || tag == 13 || tag == 16 || tag == 17 || tag == 11) ? 1.0 : 0.0;
        if (tag == 11 && aInfo.z > 0.4 && aInfo.z < 0.6) animalOnly = 0.0;   // the nuclear lamina stays

        if (tag == 8) {
          // a vesicle's life: ER exit site → cis Golgi → through the stack → trans → plasma membrane
          float k = aInfo.z;
          float t = fract(uTime * 0.045 + k * 7.13);
          vec3 exitER = uNuc + uNucDir * 4.4 + vec3(sin(k*40.0), cos(k*23.0), sin(k*17.0)) * 1.2;
          vec3 cisF = uGolgi - uNucDir * 0.4 + vec3(sin(k*9.0), cos(k*13.0), 0.0) * 0.6;
          vec3 transF = uGolgi + uNucDir * 1.8 + vec3(cos(k*11.0), sin(k*7.0), 0.0) * 0.8;
          vec3 c;
          if (t < 0.3) c = mix(exitER, cisF, smoothstep(0.0, 0.3, t));
          else if (t < 0.5) c = mix(cisF, transF, smoothstep(0.3, 0.5, t));
          else c = bez(transF, mix(transF, aAux, 0.5) + vec3(0.0, 1.2, 0.0) * sin(k*30.0), aAux, smoothstep(0.5, 0.97, t));
          float life = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.93, 1.0, t));
          p = c + position * mix(0.3, 1.0, life);
          gain = life * (0.35 + 1.4 * uVes);
          size = 1.0 + uVes * 0.6;
          pMap = vec3(route2D(k, t), 0.0) + position * 0.8;
          gain *= mix(1.0, smoothstep(0.0, 0.04, t), uMap) * (1.0 - uPlant * 0.8);
          pPlant = p;
        } else if (tag == 6) {
          float id = aInfo.z;
          vec3 w = vec3(gnoise(vec3(id, uTime*0.08, 1.0)), gnoise(vec3(id, uTime*0.08, 7.0)), gnoise(vec3(id, uTime*0.08, 13.0))) * 0.3;
          p += w; pPlant += w;
        } else if (tag == 9) {
          float front = fract(uTime * 0.05 + aInfo.w * 3.7);
          gain *= 0.55 + 0.9 * smoothstep(0.1, 0.0, abs(aInfo.z - front));
        } else if (tag == 12) {
          vec3 w = vec3(gnoise(vec3(p*0.7 + uTime*0.1)), gnoise(vec3(p*0.7 + 31.0 - uTime*0.1)), gnoise(vec3(p*0.7 + 71.0))) * 0.3;
          p += w; pPlant += w;
        } else if (tag == 20) {
          // chloroplasts drift a little in the streaming cytoplasm
          float id = aInfo.w;
          pPlant += vec3(gnoise(vec3(id, uTime*0.06, 2.0)), gnoise(vec3(id, uTime*0.06, 5.0)), gnoise(vec3(id, uTime*0.06, 9.0))) * 0.25;
          if (aInfo.z > 0.5) col = vec3(0.3, 1.0, 0.1);
        } else if (tag == 16) {
          // microvilli grow out of the surface
          float s = aInfo.z;
          float len = 1.1 * uVilli * (0.8 + 0.4 * fract(aInfo.w * 0.618));
          p = aAux * (10.0 + s * len) + (position - aAux * dot(position, aAux));
          gain *= uVilli * (0.7 + 0.6 * s);
        } else if (tag == 17) {
          // the flagellum: a wave travelling from base to tip
          float s = aInfo.z;
          vec3 d = aAux;
          vec3 side = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(side, d);
          float Lf = 26.0;
          float amp = 1.4 * smoothstep(0.0, 0.25, s);
          float ph = s * Lf * 0.42 - uTime * 7.0;
          p = d * (9.9 + s * Lf) + side * sin(ph) * amp + up * cos(ph * 0.5) * amp * 0.2 + (hash33(vec3(seed * 9.0, 1.0, 2.0)) - 0.5) * 0.12;
          gain *= uFlag * 1.2;
          pMap = p * 0.0;
        } else if (tag == 18) {
          // the bacterium: local shape, then placed; its flagella rotate as helices
          float part = aInfo.z;
          vec3 lp = position;
          if (part > 4.5 && part < 5.5) {
            float k = floor(aInfo.w);
            float s = fract(aInfo.w);
            float Lf = 5.0;
            float sp = (k - 1.5) * 0.35;
            float R = 0.2 * smoothstep(0.0, 0.15, s);
            float ph = s * Lf / 2.2 * 6.2832 - uTime * 10.0 + k;
            lp = vec3(-1.38 - s * Lf, sin(sp) * s * Lf * 0.25 + cos(ph) * R, cos(sp) * s * Lf * 0.12 + sin(ph) * R);
          }
          if (part > 1.5 && part < 2.5) col = vec3(0.4, 0.8, 0.6);
          if (part > 2.5 && part < 3.5) col = vec3(0.55, 0.85, 1.0);
          if (part > 3.5 && part < 4.5) col = vec3(0.85, 1.0, 0.8);
          float c = cos(uBactRot), s = sin(uBactRot);
          lp.xz = mat2(c, s, -s, c) * lp.xz;
          lp.xy = mat2(cos(0.25), sin(0.25), -sin(0.25), cos(0.25)) * lp.xy;
          // digested: it shrinks and browns
          lp *= 1.0 - 0.45 * uDigest;
          col = mix(col, vec3(0.6, 0.35, 0.15), uDigest * 0.8);
          p = uBactPos + lp;
          pPlant = p;
          pMap = vec3(0.0);
          gain *= uBact * (part > 1.5 && part < 2.5 ? 0.35 : part > 5.5 ? 0.6 : 1.0) * (1.0 - uDigest * 0.7);
          // close up, the packed interior piles up additively and burns out: thin it with nearness
          if (part > 1.5 && part < 4.5) gain *= 0.3 + 0.7 * smoothstep(4.0, 12.0, length(cameraPosition - p));
        } else if (tag == 0) {
          float w = gnoise(vec3(p * 0.35 + vec3(0.0, uTime * 0.15, 0.0)));
          p *= 1.0 + 0.006 * w;
        }

        /* channel gains: organelles vs cytoskeleton vs membrane */
        bool isCyto = (tag == 9 || tag == 10 || tag == 11 || tag == 13);
        float ch = 1.0;
        if (tag == 0 || tag == 16) ch = uMem;
        else if (isCyto) ch = uCyto;
        else if (tag == 12) ch = 0.5 * uOrg;
        else if (tag == 8 || tag == 17 || tag == 18) ch = 1.0;
        else if (tag == 15) ch = 0.6 * uOrg;
        else ch = uOrg;

        /* the spotlight on one kind of structure (a key term being read) */
        if (uHiAmt > 0.001) {
          bool hit = ((uHiMask >> tag) & 1) == 1;
          if (tag == 11 && aInfo.z > 0.4 && aInfo.z < 0.6) hit = ((uHiMask >> 1) & 1) == 1 || hit;
          if (tag == 3 && aInfo.z > 0.5) hit = hit || ((uHiMask >> 15) & 1) == 1;
          ch *= hit ? 1.0 + 1.6 * uHiAmt : 1.0 - 0.8 * uHiAmt;
          if (hit) size *= 1.0 + 0.35 * uHiAmt;
          if (hit && tag == 21) ch *= 1.0 + 2.0 * uHiAmt;      // the vacuole's sap is faint: lift it when it is the subject
        }

        /* animal → plant: the same kit rearranged, three structures added, five taken away */
        if (uPlant > 0.0005) {
          float k = clamp(uPlant * 1.5 - fract(seed * 5.3) * 0.5, 0.0, 1.0);
          k = k * k * (3.0 - 2.0 * k);
          vec3 lift = normalize(p + 1e-4) * sin(k * PI) * 0.9;
          p = mix(p, pPlant, k) + lift;
          gain *= mix(1.0, 0.0, animalOnly * k);
          if (tag == 21) gain *= (aInfo.z > 0.5 ? 0.25 : 0.7);
        }
        if (plantOnly > 0.5) {
          float k = clamp(uPlant * 1.6 - 0.4 - fract(seed * 3.7) * 0.2, 0.0, 1.0);
          gain *= k;
          if (tag == 19) { p = pPlant * (1.0 + (1.0 - k) * 0.12); gain *= aInfo.z > 0.5 ? 1.0 : 0.3; size *= 0.8; }
          if (tag == 21) p = mix(VAC_CENTER, pPlant, mix(0.25, 1.0, k));
          if (tag == 20) { p = pPlant; gain *= 1.3; }
        }

        /* the flow map: every point lies down on its place in the diagram */
        if (uMap > 0.0005) {
          float m = clamp(uMap * 1.6 - fract(seed * 5.3) * 0.6, 0.0, 1.0);
          m = m * m * (3.0 - 2.0 * m);
          vec3 target = vec3(uDiagC, 0.0) + vec3(pMap.xy, 0.0);
          if (tag == 8) target = pMap;
          p = mix(p, target, m) + vec3(0.0, 0.0, sin(m * PI) * (1.5 + 5.0 * fract(seed * 3.3)));
          float dg = 1.0;
          if (tag == 0) dg = 0.3;
          else if (tag == 10) dg = 0.22;
          else if (tag == 9) dg = 1.5;
          else if (tag == 11) dg = (aInfo.z > 0.4 && aInfo.z < 0.6) ? 0.8 : 0.0;
          else if (tag == 12 || tag == 13 || tag >= 14) dg = 0.0;
          else if (tag == 2) dg = 0.55;
          else if (tag == 6) dg = mix(1.0, 0.12, uMapHi);    // not part of the endomembrane system
          ch = mix(ch, dg, m);
        }

        /* a macrophage: it flattens, crawls, reaches out with filopodia and swallows the bacterium */
        if (uMacro > 0.0005 && tag != 18 && tag != 19 && tag != 20 && tag != 21) {
          float k = uMacro;
          vec3 q = p;
          q.y *= mix(1.0, 0.62, k);
          q.x *= mix(1.0, 1.18, k);
          // ruffles along the leading edge
          if (tag == 0 || tag == 10) {
            vec3 d = normalize(position);
            float lead = smoothstep(0.2, 0.9, dot(d, normalize(uBactPos)));
            q += d * lead * k * (0.6 + 0.6 * gnoise(vec3(d * 3.0 + uTime * 0.4)));
            // filopodia: thin fingers toward the prey (one point in ten is drafted into one)
            float f = fract(seed * 17.31);
            if (f < 0.11) {
              float id = floor(f / 0.11 * 9.0);
              vec3 h = hash33(vec3(id, 3.0, 7.0)) - 0.5;
              vec3 ax = normalize(normalize(uBactPos) * 1.6 + h * 1.4);
              vec3 base = ax * 10.0;
              base.y *= 0.62;
              base.x *= 1.18;
              vec3 tip = mix(base + ax * (4.0 + 5.0 * fract(id * 0.37)), uBactPos + h * 0.6, (id < 3.0 ? 1.0 : 0.25) * smoothstep(0.3, 0.6, uEngulf));
              float s = fract(seed * 91.7);
              vec3 pf = mix(base, tip, s) + (hash33(vec3(seed * 33.0, 1.0, 1.0)) - 0.5) * 0.12 * (1.0 - s);
              q = mix(q, pf, smoothstep(0.0, 0.5, k) * smoothstep(0.85, 0.65, uEngulf));
            }
            // the phagocytic cup closes round the bacterium, then pinches off inside
            vec3 bd = normalize(uBactPos);
            float ac = acos(clamp(dot(d, bd), -1.0, 1.0));
            float wrap = smoothstep(0.55, 0.85, uEngulf);
            float cup = exp(-(ac / 0.32) * (ac / 0.32)) * wrap;
            q = mix(q, uBactPos + normalize(q - uBactPos + 1e-4) * 1.6, cup * 0.9);
          }
          // lysosomes converge on the phagosome and fuse
          if (tag == 7) {
            vec3 h = hash33(vec3(aInfo.z, 5.0, 2.0)) - 0.5;
            vec3 tgt = uBactPos + normalize(h + 1e-3) * (1.0 + 0.6 * fract(seed * 7.0));
            q = mix(q, tgt, smoothstep(0.75, 0.92, uEngulf + aInfo.z * 0.004));
          }
          p = mix(p, q, 1.0);
          if (tag == 6) gain *= 1.0 + 0.6 * k * (0.5 + 0.5 * sin(uTime * 3.0 + aInfo.z));
          if (tag == 0 || tag == 10) gain *= 1.0 + 1.2 * k;            // the crawling outline reads
        }

        /* fractionation: the cell is broken up, and four spins sort its pieces into pellets */
        if (uHomog > 0.0005 && tag != 18 && plantOnly < 0.5) {
          int c = fraction(tag, aInfo.z);
          float s = uFrac;
          vec3 h = hash33(vec3(seed * 13.0, seed * 3.0, 11.0));
          float fill = 1.0 - min(s, 4.0) * 0.12;
          // where is it now: settled in an earlier pellet, settling now, or still in the supernatant
          int run = int(floor(clamp(s, 0.0, 3.999)));
          float u = s - float(run);
          vec3 cur;
          float settled = 0.0;
          if (s >= 4.0 && c <= 3) { cur = swung(pellet(seed, c), c); settled = 1.0; }
          else if (c < run) { cur = swung(pellet(seed, c), c); settled = 1.0; }
          else if (c == run) {
            float sp = smoothstep(0.08 + h.x * 0.25, 0.62 + h.x * 0.1, u);
            settled = sp;
            cur = swung(mix(suspended(seed, fill), pellet(seed, c), sp), run);
          } else {
            vec3 a = swung(suspended(seed, fill), run);
            if (run < 3) {
              vec3 b = swung(suspended(seed, fill - 0.12), run + 1);
              float pk = smoothstep(0.72 + h.y * 0.12, 0.9 + h.y * 0.08, u);
              vec3 mid = (a + b) * 0.5 + vec3(0.0, 11.0, 0.0);
              cur = bez(a, mid, b, pk);
            } else cur = a;
          }
          // the homogenate pours in, swirling
          float k = clamp(uHomog * 1.4 - h.z * 0.4, 0.0, 1.0);
          k = k * k * (3.0 - 2.0 * k);
          vec3 start = p;
          vec3 mid = mix(start, cur, 0.5) + vec3(0.0, 12.0, 0.0) + normalize(start + 1e-4) * 4.0;
          p = bez(start, mid, cur, k);
          if (c == 4) col = mix(col, vec3(0.4, 0.5, 0.7), 0.5 * k);
          gain *= mix(1.0, (c == 4 ? 0.25 : 0.7) * (tag == 0 ? 0.5 : 1.0), k) * (1.0 + settled * 0.8);
          size *= mix(1.0, 0.9, k) * (1.0 + settled * 0.3);
          // each pellet takes the colour of what it holds
          if (settled > 0.5) col = c == 0 ? vec3(0.3, 0.45, 1.0) : c == 1 ? vec3(1.0, 0.25, 0.55) : c == 2 ? mix(col, vec3(0.3, 1.0, 0.5), 0.5) : vec3(0.9, 1.0, 0.9);
          ch = mix(ch, 1.0, k);
        }

        /* the drawing inflates into a cell: depth grows from nothing */
        if (uFlat > 0.0005) {
          vec3 vz = uView;
          float dz = dot(p, vz);
          p -= vz * dz * uFlat;
        }

        /* the whole cell at work */
        if (uLive > 0.001 && tag == 0) {
          vec3 d = normalize(position);
          float dent = 0.0;
          for (int i = 0; i < 7; i++) {
            float a = acos(clamp(dot(d, uPits[i]), -1.0, 1.0));
            float depth = 0.5 + 0.5 * sin(uTime * 1.3 + float(i) * 1.9);
            dent += exp(-(a / 0.07) * (a / 0.07)) * depth * 0.9;
          }
          p -= d * dent * uLive;
          gain *= 1.0 + dent * uLive * 1.5;
        }

        /* the cursor clears a hole through the cytoplasm */
        vec3 op = p - uRayO;
        float along = dot(op, uRayD);
        vec3 perp = op - uRayD * along;
        float dd = length(perp);
        p += normalize(perp + 1e-5) * exp(-dd*dd / 3.0) * 1.4 * uMouseF * (1.0 - uMap) * (1.0 - uHomog) * (1.0 - step(0.5, uMode));

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float blur = clamp(abs(dist - uFocus) / uFocus * 1.1 - 0.08, 0.0, 1.0);
        float px = (1.6 + blur * 4.0) * size * uPx * (40.0 / dist);
        float a = 1.5 * gain * ch * uAlpha * (0.5 + 0.4 * fract(seed * 7.1)) / (1.0 + blur * 2.2);
        a *= smoothstep(0.35, 1.3, dist);
        if (tag == 3 && aInfo.z > 0.5) a *= 2.0;
        if (tag == 2 && aInfo.z > 0.5) a *= 1.6;
        if (tag == 14 && aInfo.z > 0.5) a *= 1.8;
        vHard = 0.0;
        vLin = 0.0;

        /* ---- what each microscope records ---- */
        if (uMode > 0.5) {
          bool nucl = tag == 1 || tag == 2 || (tag == 3 && aInfo.z > 0.5) || tag == 15;
          bool hidden = tag == 17 || tag == 18 || plantOnly > 0.5 || (tag == 8 && gain < 0.05);
          float dz = dot(p - uFocusP, uView);
          blur = 0.0;
          float sharp = 1.5 * uPx * (34.0 / dist);
          if (uMode < 1.5) {
            // brightfield, unstained: nearly transparent
            float w = nucl ? 0.5 : tag == 12 ? 0.6 : tag == 0 ? 0.3 : 0.35;
            col = vec3(w); a = 0.05 * gain; px = sharp; vHard = 0.5;
          } else if (uMode < 2.5) {
            // H&E: hematoxylin blues nucleic acid, eosin pinks protein
            col = nucl ? vec3(0.55, 0.62, 0.12) : vec3(0.03, 0.5, 0.22);
            a = (nucl ? 0.16 : tag == 12 ? 0.1 : 0.06) * gain; px = sharp; vHard = 0.5;
          } else if (uMode < 4.5) {
            float w = nucl ? 0.7 : tag == 12 ? 0.6 : 0.4;
            col = vec3(w); a = 0.06 * gain; px = sharp; vHard = 0.5;
          } else if (uMode < 5.5) {
            // confocal: only one optical section survives the pinhole
            float sec = exp(-(dz / 0.45) * (dz / 0.45));
            a *= sec * 2.2;
            px = (1.6 * size * uPx * (26.0 / dist));
          } else if (uMode < 6.5) {
            // SEM: only the surface, shaded by its tilt; edges throw more electrons
            bool surf = tag == 0 || tag == 16;
            vec3 nrm = normalize(tag == 16 ? (position - aAux * dot(position, aAux)) + aAux * 0.3 : p);
            vec3 V = normalize(uRayO - p);
            float facing = dot(nrm, V);
            float tilt = 1.0 / max(facing, 0.12);
            float lit = 0.35 + 0.65 * max(dot(nrm, normalize(vec3(-0.5, 0.7, 0.5))), 0.0);
            col = vec3(0.55) * lit * min(tilt, 4.0) * 0.6;
            a = surf && facing > 0.0 ? 0.12 * gain : 0.0;
            px = (3.6 + 2.0 * float(tag == 16)) * uPx * (26.0 / dist);
            vHard = 1.0;
          } else {
            // TEM: a 0.1 µm slice; heavy metals stick to membranes, chromatin and ribosomes
            float sl = exp(-(dz / 0.11) * (dz / 0.11));
            float e = tag == 2 ? 1.6 : (tag == 3 && aInfo.z > 0.5) || tag == 15 ? 1.8 : tag == 7 ? 1.4 : tag == 14 ? 1.2 : tag == 12 ? 0.18 : (tag == 9 || tag == 10 || tag == 11) ? 0.3 : 0.85;
            col = vec3(e);
            a = sl * 2.2 * gain;
            px = 2.4 * uPx * (34.0 / dist);
            vHard = 1.0;
          }
          if (hidden) a = 0.0;
          // transmitted and electron signals add linearly (the dye glow keeps its soft squared falloff)
          vLin = abs(uMode - 5.0) < 0.5 ? 0.0 : 1.0;
        }

        gl_PointSize = clamp(px, 1.0, 26.0);
        vBlur = blur;
        vCol = col;
        vA = a;
      }`.replace('VAC_CENTER', `vec3(${VAC_C.x.toFixed(2)}, ${VAC_C.y.toFixed(2)}, ${VAC_C.z.toFixed(2)})`),
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      in vec3 vCol; in float vA; in float vBlur; in float vHard; in float vLin;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c);
        float disk = mix(smoothstep(0.5, 0.0, r), smoothstep(0.5, 0.42, r) * 0.7 + 0.3 * smoothstep(0.5, 0.0, r), vBlur);
        disk = mix(disk, smoothstep(0.5, 0.25, r), vHard);
        if (disk < 0.01) discard;
        o = vec4(vCol * vA * disk, mix(vA * disk * 0.3, 1.0, vLin));
      }`,
  })
  const points = new THREE.Points(g, mat)
  points.frustumCulled = false
  return { points, mat }
}

/** tag masks for the spotlight on a kind of structure */
export const MASK: Record<string, number> = {
  nucleus: (1 << T.NE) | (1 << T.CHROM),
  envelope: 1 << T.NE,
  chromatin: 1 << T.CHROM,
  rer: 1 << T.RER,
  ser: 1 << T.SER,
  er: (1 << T.RER) | (1 << T.SER),
  golgi: 1 << T.GOLGI,
  mito: 1 << T.MITO,
  lyso: 1 << T.LYSO,
  ves: 1 << T.VES,
  perox: 1 << T.PEROX,
  ribo: 1 << T.RIBO,
  cyto: (1 << T.MT) | (1 << T.ACTIN) | (1 << T.IF) | (1 << T.CENT),
  mt: 1 << T.MT,
  actin: 1 << T.ACTIN,
  ifil: 1 << T.IF,
  centrosome: (1 << T.CENT) | (1 << T.MT),
  pm: (1 << T.PM) | (1 << T.VILLI),
  villi: 1 << T.VILLI,
  flag: 1 << T.FLAG,
  bact: 1 << T.BACT,
  wall: 1 << T.WALL,
  chloro: 1 << T.CHLORO,
  vac: 1 << T.VAC,
  plasmod: (1 << T.WALL) | (1 << T.PM),
  macro: (1 << T.PM) | (1 << T.ACTIN), filo: 1 << T.ACTIN,
}
