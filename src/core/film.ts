/* ==========================================================================
   THE FILM
   Scroll becomes one continuous film time F ∈ [0, 18]. This file turns F into
   every camera, set, transition and stage the renderer and the DOM need. It
   is a pure function of F, so scrolling back reverses everything exactly.

   Seven sets, each with its own units:
     SCALE  metres, log zoom   the hero lens, then Figure 4.2's fall from a
                               person to an atom (a flat procedural world)
     CELL   1 unit = 1 µm      the particle cell: microscopes, centrifuge,
                               prokaryote vs eukaryote, animal ↔ plant,
                               the flow map, the macrophage
     IN     1 unit = 10 nm     inside: nuclear envelope and pores, chromatin,
                               ribosomes, ER, Golgi, lysosomes, one journey
     ORG    1 unit = 100 nm    endosymbiosis, mitochondria, chloroplasts,
                               peroxisomes, plastids (raymarched sections)
     FIB    1 unit = 1 nm      the cytoskeleton molecule by molecule; the axoneme
     ECM    1 unit = 10 nm     plant cell wall, extracellular matrix, plasmodesma
     EPI    1 unit = 100 nm    an epithelium and its junctions
   Sets hand over by transitions: a lens-portal (one scale opens inside the
   other) or a dissolve.
   ========================================================================== */

import * as THREE from 'three'

export const CHAPTERS = [
  'A Tour of the Cell',
  'Powers of ten',
  'Seeing cells',
  'Taking cells apart',
  'Two kinds of cell',
  'The panorama',
  'The nucleus',
  'Ribosomes',
  'Endoplasmic reticulum',
  'The Golgi apparatus',
  'Lysosomes and vacuoles',
  'Endosymbiosis',
  'Power plants',
  'The cytoskeleton',
  'Cilia and flagella',
  'Walls and matrix',
  'Cell junctions',
  'Greater than the sum',
]
export const LAST = CHAPTERS.length // 18

export type SetName = 'scale' | 'cell' | 'in' | 'org' | 'fib' | 'ecm' | 'epi'

/* ---------------------------------------------------------------- helpers */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const band = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** piecewise-linear lookup in [[F, value], …], eased between keys */
export function keyed(keys: [number, number][], F: number, ease = true) {
  if (F <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (F <= keys[i][0]) {
      const [f0, v0] = keys[i - 1]
      const [f1, v1] = keys[i]
      let t = (F - f0) / Math.max(1e-6, f1 - f0)
      if (ease) t = t * t * (3 - 2 * t)
      return v0 + (v1 - v0) * t
    }
  }
  return keys[keys.length - 1][1]
}

/* ------------------------------------------------------------ set spans
   [from, to] in F. Where two overlap, the first is outer and the second
   opens inside it by the transition listed for that interval. */
type Span = { set: SetName; a: number; b: number }
const SPANS: Span[] = [
  { set: 'scale', a: 0, b: 2.15 },
  { set: 'cell', a: 2.09, b: 5.99 },
  { set: 'in', a: 5.9, b: 10.7 },
  { set: 'cell', a: 10.62, b: 11.06 },
  { set: 'org', a: 11.0, b: 13.06 },
  { set: 'fib', a: 13.0, b: 15.06 },
  { set: 'ecm', a: 15.0, b: 16.24 },
  { set: 'epi', a: 16.18, b: 17.06 },
  { set: 'cell', a: 17.0, b: 18.01 },
]
type Trans = { a: number; b: number; style: 'lens' | 'fade'; reverse?: boolean; cx?: number; cy?: number }
export const TRANS: Trans[] = [
  { a: 2.09, b: 2.15, style: 'fade' },
  { a: 5.9, b: 5.99, style: 'lens', cx: 0.47, cy: 0.52 },
  // the inside world shrinks back into a lens within the cell
  { a: 10.62, b: 10.7, style: 'lens', reverse: true, cx: 0.5, cy: 0.5 },
  { a: 11.0, b: 11.06, style: 'lens', cx: 0.5, cy: 0.5 },
  { a: 13.0, b: 13.06, style: 'fade' },
  { a: 15.0, b: 15.06, style: 'fade' },
  { a: 16.18, b: 16.24, style: 'lens', cx: 0.5, cy: 0.5 },
  { a: 17.0, b: 17.06, style: 'fade' },
]

/* ----------------------------------------------------------- camera paths */
type Key = { f: number; p: [number, number, number]; t: [number, number, number]; fov: number }
/* the cell, head-on, framed exactly as the drawing it grows out of: view height 47.6 µm, shifted right */
const MIC: [number, number, number] = [-3.3, 0, 77.9]
const MIC_T: [number, number, number] = [-3.3, 0, 0]
const TX = [-10.5, -3.5, 3.5, 10.5]
/* the camera through the four runs of the centrifuge (see FRAC) */
function spinKeys(): Key[] {
  const runs: [number, number][] = [[3.18, 3.36], [3.41, 3.57], [3.6, 3.73], [3.75, 3.86]]
  const out: Key[] = []
  runs.forEach(([a, b], j) => {
    const L = b - a
    out.push({ f: a + 0.06 * L, p: [TX[j] + 5, 11, 40], t: [TX[j] + 5, 6.5, 0], fov: 38 })
    out.push({ f: a + 0.6 * L, p: [TX[j] + 7, 10, 38], t: [TX[j] + 7, 6.5, 0], fov: 38 })
    out.push({ f: a + 0.8 * L, p: [TX[j] + 3, 6, 32], t: [TX[j] + 3, 2, 0], fov: 38 })
    if (j < 3) out.push({ f: b + 0.02, p: [TX[j + 1] - 1, 5, 31], t: [TX[j + 1], 1.5, 0], fov: 38 })
  })
  return out
}
const CAM: Record<SetName, Key[]> = {
  scale: [{ f: 0, p: [0, 0, 1], t: [0, 0, 0], fov: 34 }, { f: 18, p: [0, 0, 1], t: [0, 0, 0], fov: 34 }],
  cell: [
    { f: 2.09, p: MIC, t: MIC_T, fov: 34 },
    { f: 2.16, p: MIC, t: MIC_T, fov: 34 },
    { f: 2.24, p: [-14, 8, 66], t: [-5.5, 0, 0], fov: 34 },
    { f: 2.3, p: [-2.4, 0, 52], t: [-2.4, 0, 0], fov: 34 },
    // the microscopes: head-on, like looking down an eyepiece
    { f: 2.53, p: [-2.4, 0, 52], t: [-2.4, 0, 0], fov: 34 },
    // SEM: swing round to see the surface in relief
    { f: 2.6, p: [-22, 26, 50], t: [-4.8, 0, 0], fov: 34 },
    { f: 2.68, p: [-30, 14, 52], t: [-5.2, 0, 0], fov: 34 },
    { f: 2.72, p: [-2.4, 0, 52], t: [-2.4, 0, 0], fov: 34 },
    { f: 2.86, p: [-2.4, 0, 52], t: [-2.4, 0, 0], fov: 34 },
    { f: 2.96, p: [12, 10, 60], t: [-4, 0, 0], fov: 36 },
    // the centrifuge: follow each tube as it swings out on the rotor, then pours into the next
    { f: 3.06, p: [-8, 18, 60], t: [-4, 4, 0], fov: 38 },
    { f: 3.16, p: [TX[0] - 4, 5, 30], t: [TX[0], 1.5, 0], fov: 38 },
    ...spinKeys(),
    { f: 3.9, p: [2, 2, 44], t: [1.5, -1.5, 0], fov: 38 },
    { f: 3.96, p: [2, 2, 46], t: [1.5, -1.5, 0], fov: 38 },
    // two kinds of cell: start on the bacterium, then pull back to the eukaryote
    { f: 4.04, p: [18.1, 0.2, 10.9], t: [15.9, -1.8, 4.5], fov: 34 },
    { f: 4.16, p: [19.0, 0.4, 10.0], t: [16.3, -1.8, 4.5], fov: 34 },
    { f: 4.32, p: [20.0, 0.6, 10.2], t: [16.5, -1.9, 4.5], fov: 34 },
    { f: 4.45, p: [8, 6, 52], t: [4.5, -0.5, 1], fov: 38 },
    // Figure 4.6: the cubes
    { f: 4.52, p: [-40, 7, 30], t: [-36, 0, 0], fov: 36 },
    { f: 4.7, p: [-38, 10, 36], t: [-36.5, 0, 0], fov: 36 },
    { f: 4.76, p: [-14, 14, 44], t: [-5.6, 2, 0], fov: 36 },
    { f: 4.84, p: [-10, 20, 42], t: [-5.4, 3, 0], fov: 36 },
    { f: 4.94, p: [-7.6, 2, 66], t: [-6.2, 0, 0], fov: 34 },
    { f: 5.0, p: [-7.6, 2, 64], t: [-6.2, 0, 0], fov: 34 },
    // the panorama: a slow tour, then the plant cell, then into the nucleus
    { f: 5.14, p: [-20, 10, 50], t: [-4.5, 0, 0], fov: 36 },
    { f: 5.3, p: [8, -14, 50], t: [-4.8, 0, 0], fov: 36 },
    { f: 5.36, p: [2, 10, 60], t: [-6, 0, 0], fov: 38 },
    { f: 5.52, p: [-6, 20, 64], t: [5, 0, 0], fov: 38 },
    { f: 5.68, p: [22, 13, 62], t: [5.5, 0, 0], fov: 38 },
    { f: 5.76, p: [-4, 6, 54], t: [-5.5, 0, 0], fov: 36 },
    { f: 5.84, p: [-6, 3, 26], t: [-2.8, 0.3, -0.5], fov: 38 },
    { f: 5.92, p: [-1.8, 0.8, 7.5], t: [-1.2, 0.3, -0.5], fov: 50 },
    { f: 5.99, p: [-1.5, 0.6, 5.0], t: [-1.2, 0.3, -0.5], fov: 56 },
    { f: 10.62, p: [-1.5, 0.6, 5.0], t: [-1.2, 0.3, -0.5], fov: 56 },
    // a plant cell's central vacuole, then the flow map
    { f: 10.7, p: [-4, 12, 60], t: [5, 0, 0], fov: 40 },
    { f: 10.78, p: [18, 14, 62], t: [5, 0, 0], fov: 40 },
    { f: 10.86, p: [0, 0, 32], t: [0, 0, 0], fov: 36 },
    { f: 10.97, p: [0, 0, 32], t: [0, 0, 0], fov: 36 },
    { f: 11.0, p: [0, 0, 30], t: [0, 0, 0], fov: 36 },
    { f: 11.06, p: [0, 0, 22], t: [0, 0, 0], fov: 40 },
    { f: 17.0, p: [-24, 10, 66], t: [9, 0, 0], fov: 38 },
    { f: 17.08, p: [-16, 12, 56], t: [10, 0, 0], fov: 38 },
    { f: 17.3, p: [-2, 16, 48], t: [11, -0.5, 1], fov: 38 },
    { f: 17.5, p: [8, 12, 40], t: [9, -0.5, 2], fov: 38 },
    { f: 17.62, p: [-10, 16, 52], t: [3, 0, 0], fov: 38 },
    { f: 17.76, p: [-14, 8, 64], t: [0, 0, 0], fov: 36 },
    { f: 18.0, p: [-10, 4, 70], t: [-4, 0, 0], fov: 34 },
  ],
  in: [
    // the nuclear envelope from the cytoplasm: pores everywhere, ribosomes on the outer membrane
    { f: 5.9, p: [80, 34, 130], t: [-18, 0, 0], fov: 46 },
    { f: 6.04, p: [62, 26, 96], t: [-18, 0, 0], fov: 46 },
    { f: 6.17, p: [24, 12, 40], t: [-18, 0, 0], fov: 46 },
    // one pore complex, close
    { f: 6.25, p: [3, 4.5, 14], t: [-18, 0, 0], fov: 50 },
    // through it
    { f: 6.31, p: [-9, 0.5, 1.5], t: [-40, -1, 0], fov: 60 },
    { f: 6.36, p: [-34, 2, 6], t: [-70, -8, 0], fov: 56 },
    // the lamina, looking back at the envelope's inner face
    { f: 6.4, p: [-48, -6, 26], t: [-22, 0, 0], fov: 50 },
    // chromatin: nucleosomes on a string, then the whole chromosome
    { f: 6.45, p: [-119, -6, 10], t: [-130, -14, 4], fov: 48 },
    { f: 6.53, p: [-121, -10, 12], t: [-130, -14, 4], fov: 48 },
    { f: 6.6, p: [-120, 6, 80], t: [-136, -14, -10], fov: 46 },
    { f: 6.75, p: [-176, -6, 200], t: [-112, -14, 4], fov: 44 },
    // the nucleolus, and subunits streaming to the pores
    { f: 6.82, p: [-70, 90, 120], t: [-150, 55, 30], fov: 46 },
    { f: 6.9, p: [-40, 30, 60], t: [-60, 20, 0], fov: 50 },
    // back out through a pore after them
    { f: 6.96, p: [-22, 1, 3], t: [0, 2, 0], fov: 58 },
    // the hero ribosome on its mRNA, free in the cytosol
    { f: 7.02, p: [18, 31, 18], t: [10, 26, 10], fov: 46 },
    { f: 7.18, p: [16, 30, 16], t: [10, 26, 10], fov: 44 },
    { f: 7.3, p: [22, 40, 30], t: [12, 28, 6], fov: 46 },
    // it docks on the rough ER; the section shows the chain entering the lumen
    { f: 7.4, p: [24, -58, 22], t: [8, -70, 0], fov: 46 },
    { f: 7.6, p: [17, -64, 15], t: [6, -71, 0], fov: 42 },
    { f: 7.76, p: [15, -66, 13], t: [4, -72, 0], fov: 42 },
    { f: 7.9, p: [34, -40, 50], t: [2, -60, 0], fov: 46 },
    // the endomembrane system, cut open
    { f: 8.03, p: [150, 50, 300], t: [10, 20, 0], fov: 44 },
    { f: 8.16, p: [60, 26, 110], t: [-6, 12, 0], fov: 44 },
    { f: 8.28, p: [30, 14, 60], t: [-4, 10, 0], fov: 46 },
    // rough ER and the transitional ER's bud
    { f: 8.32, p: [68, -36, 26], t: [48, -43, 6], fov: 44 },
    { f: 8.42, p: [64, -34, 22], t: [49, -42, 6], fov: 44 },
    // the smooth ER and its calcium
    { f: 8.48, p: [90, -150, 170], t: [55, -140, 0], fov: 46 },
    { f: 8.6, p: [80, -130, 110], t: [56, -138, 0], fov: 46 },
    { f: 8.72, p: [84, -136, 120], t: [56, -138, 0], fov: 46 },
    { f: 8.88, p: [140, -200, 300], t: [50, -150, 0], fov: 46 },
    { f: 8.96, p: [120, 60, 200], t: [60, 0, 0], fov: 46 },
    // the vesicle carries its cargo to the Golgi
    { f: 9.04, p: [96, -10, 70], t: [80, -20, 0], fov: 46 },
    { f: 9.14, p: [100, 20, 50], t: [110, -4, 0], fov: 46 },
    { f: 9.2, p: [125, 50, 110], t: [125, -5, 0], fov: 44 },
    { f: 9.3, p: [126, 14, 50], t: [125, -5, 0], fov: 44 },
    // side on, cut: the cisternae mature cis → trans
    { f: 9.36, p: [124, -2, 95], t: [125, -5, 0], fov: 42 },
    { f: 9.53, p: [126, -2, 92], t: [126, -5, 0], fov: 42 },
    // the trans face ships out
    { f: 9.6, p: [170, 40, 100], t: [180, 0, 0], fov: 46 },
    { f: 9.74, p: [250, 80, 120], t: [290, 50, 20], fov: 46 },
    { f: 9.84, p: [300, 76, 60], t: [330, 62, 28], fov: 44 },
    { f: 9.95, p: [290, 60, 90], t: [310, 40, 20], fov: 46 },
    // a lysosome
    { f: 10.04, p: [250, 72, 20], t: [215, 55, -30], fov: 46 },
    { f: 10.14, p: [244, 66, 10], t: [215, 55, -30], fov: 46 },
    // phagocytosis at the membrane, cut
    { f: 10.2, p: [290, -30, 80], t: [322, -38, 0], fov: 46 },
    { f: 10.32, p: [280, -40, 76], t: [300, -40, 0], fov: 46 },
    // autophagy
    { f: 10.38, p: [270, 140, 70], t: [262, 92, -18], fov: 46 },
    { f: 10.47, p: [256, 130, 64], t: [258, 88, -18], fov: 46 },
    // a lysosome swelling with what it can't digest
    { f: 10.55, p: [250, 80, 30], t: [215, 55, -30], fov: 48 },
    { f: 10.7, p: [262, 92, 52], t: [215, 55, -30], fov: 50 },
  ],
  org: [
    // endosymbiosis: a host cell, an aerobe approaching from the right
    { f: 11.0, p: [0, 0, 260], t: [0, 0, 0], fov: 40 },
    { f: 11.06, p: [20, 12, 220], t: [14, 0, 0], fov: 40 },
    { f: 11.18, p: [44, 12, 190], t: [34, 0, 0], fov: 40 },
    { f: 11.32, p: [28, 0, 130], t: [22, -8, 0], fov: 40 },
    { f: 11.39, p: [8, 0, 165], t: [4, -8, 0], fov: 40 },
    { f: 11.46, p: [-40, -18, 165], t: [-36, -26, 0], fov: 40 },
    { f: 11.54, p: [0, -8, 190], t: [0, -8, 0], fov: 40 },
    // the evidence, close
    { f: 11.6, p: [30, -10, 48], t: [26, -15, 0], fov: 40 },
    { f: 11.8, p: [34, -6, 56], t: [28, -12, 0], fov: 40 },
    { f: 11.92, p: [0, 0, 240], t: [0, 0, 0], fov: 40 },
    // a mitochondrion, cut open
    { f: 12.0, p: [300, 14, 70], t: [300, 0, 0], fov: 40 },
    { f: 12.17, p: [300, 8, 40], t: [299, 0, 0], fov: 40 },
    { f: 12.3, p: [304, 10, 30], t: [302, 0, 0], fov: 40 },
    // living mitochondria
    { f: 12.35, p: [520, 14, 95], t: [520, 0, 0], fov: 40 },
    { f: 12.42, p: [525, 10, 85], t: [520, 0, 0], fov: 40 },
    // a chloroplast
    { f: 12.47, p: [760, 20, 95], t: [760, 0, 0], fov: 40 },
    { f: 12.6, p: [764, 10, 50], t: [762, 0, 0], fov: 40 },
    // plastids
    { f: 12.66, p: [1000, 6, 80], t: [1000, 0, 0], fov: 40 },
    { f: 12.76, p: [1000, 6, 72], t: [1000, 0, 0], fov: 40 },
    // a peroxisome
    { f: 12.8, p: [1222, 3, 22], t: [1220, 0, 0], fov: 40 },
    { f: 12.94, p: [1224, 3, 26], t: [1220, 0, 0], fov: 40 },
    { f: 13.06, p: [1224, 3, 30], t: [1220, 0, 0], fov: 40 },
  ],
  fib: [
    // three fibres, to scale, side by side
    { f: 13.0, p: [60, -40, 420], t: [60, -40, 0], fov: 40 },
    { f: 13.1, p: [60, -20, 330], t: [60, -10, 0], fov: 40 },
    // a microtubule, close, then end-on into its lumen
    { f: 13.18, p: [30, 40, 60], t: [0, 40, 0], fov: 40 },
    { f: 13.25, p: [4, 330, 22], t: [0, 200, 0], fov: 44 },
    // growth and catastrophe at the plus end
    { f: 13.31, p: [36, 210, 70], t: [0, 210, 0], fov: 40 },
    { f: 13.41, p: [30, 190, 64], t: [0, 170, 0], fov: 40 },
    // kinesin walking, hauling its vesicle
    { f: 13.425, p: [-170, -10, 420], t: [-220, -90, 200], fov: 40 },
    // these keys follow the motor itself (8 nm a step), so the spline can't drift off it
    { f: 13.45, p: [-142, -38, 420], t: [-202, -84, 200], fov: 40 },
    { f: 13.47, p: [-110, -38, 420], t: [-170, -84, 200], fov: 40 },
    { f: 13.5, p: [-46, -38, 420], t: [-106, -84, 200], fov: 40 },
    { f: 13.53, p: [10, -38, 420], t: [-50, -84, 200], fov: 40 },
    { f: 13.56, p: [42, -38, 420], t: [-18, -84, 200], fov: 40 },
    // actin and myosin
    { f: 13.6, p: [120, -220, 70], t: [70, -240, 0], fov: 40 },
    { f: 13.7, p: [110, -260, 60], t: [74, -260, 0], fov: 40 },
    // an intermediate filament
    { f: 13.75, p: [172, -318, 62], t: [142, -340, 0], fov: 40 },  // the rope runs y −530 … −278
    { f: 13.82, p: [160, -372, 46], t: [140, -380, 0], fov: 40 },
    // the centrosome
    { f: 13.88, p: [1500, 420, 1100], t: [900, -60, 100], fov: 40 },
    { f: 14.0, p: [1400, 300, 1000], t: [900, -60, 100], fov: 40 },
    // cilia and a flagellum (1/100 scale)
    { f: 14.04, p: [4000, 120, 300], t: [4020, 30, 0], fov: 40 },
    { f: 14.15, p: [4040, 90, 250], t: [4040, 30, 0], fov: 40 },
    // the axoneme, end-on: 9 + 2
    { f: 14.2, p: [2000, 0, 460], t: [2000, 0, 0], fov: 40 },
    { f: 14.32, p: [2000, -40, 400], t: [2000, 0, 0], fov: 40 },
    // the basal body beside it: 9 + 0
    { f: 14.37, p: [2160, 0, 640], t: [2160, 0, 0], fov: 40 },
    { f: 14.45, p: [2160, 0, 620], t: [2160, 0, 0], fov: 40 },
    // two doublets side on: sliding, then bending
    { f: 14.5, p: [2000, 600, 760], t: [2000, 600, 0], fov: 40 },
    { f: 14.68, p: [2040, 620, 720], t: [2030, 600, 0], fov: 40 },
    // primary cilium: 9 + 0; then the beat stops
    { f: 14.73, p: [2320, 0, 420], t: [2320, 0, 0], fov: 40 },
    { f: 14.8, p: [4000, 120, 300], t: [4020, 30, 0], fov: 40 },
    { f: 15.06, p: [4040, 100, 280], t: [4030, 30, 0], fov: 40 },
  ],
  ecm: [
    // the wall being spun
    { f: 15.0, p: [60, 30, 110], t: [0, 8, 0], fov: 42 },
    { f: 15.16, p: [40, 16, 70], t: [0, 4, 0], fov: 42 },
    // its layers, side on
    { f: 15.22, p: [10, 30, 210], t: [0, 26, 0], fov: 40 },
    { f: 15.32, p: [-10, 24, 190], t: [0, 20, 0], fov: 40 },
    // an animal cell's matrix
    { f: 15.37, p: [990, 70, 190], t: [900, 25, 0], fov: 42 },
    { f: 15.5, p: [960, 50, 140], t: [900, 20, 0], fov: 42 },
    // integrins, close
    { f: 15.56, p: [930, 12, 60], t: [900, 2, 0], fov: 42 },
    { f: 15.7, p: [940, 30, 120], t: [900, 0, 0], fov: 42 },
    // the signal runs inward
    { f: 15.9, p: [970, -40, 160], t: [900, -30, 0], fov: 42 },
    { f: 15.98, p: [60, 40, 160], t: [0, 30, 40], fov: 42 },
    // the plasmodesma
    { f: 16.04, p: [30, 40, 120], t: [0, 36, 60], fov: 42 },
    { f: 16.18, p: [12, 40, 86], t: [0, 36, 60], fov: 46 },
    { f: 16.24, p: [4, 40, 70], t: [0, 36, 60], fov: 50 },
  ],
  epi: [
    // the intestinal lining, cut open
    { f: 16.18, p: [40, 160, 420], t: [0, 20, 0], fov: 40 },
    { f: 16.32, p: [30, 140, 360], t: [0, 20, 0], fov: 40 },
    // tight junctions: dye on top stays on top
    { f: 16.38, p: [10, 84, 88], t: [50, 70, -4], fov: 40 },
    { f: 16.47, p: [14, 78, 80], t: [52, 66, -4], fov: 40 },
    // desmosomes: the same shared face, lower down
    { f: 16.52, p: [10, 62, 74], t: [35, 48, -4], fov: 40 },
    { f: 16.6, p: [16, 46, 80], t: [35, 34, -4], fov: 40 },
    // gap junctions: dye in one cell spreads to the next
    { f: 16.67, p: [0, 120, 330], t: [0, 10, 0], fov: 40 },
    { f: 16.86, p: [-20, 140, 380], t: [0, 10, 0], fov: 40 },
    { f: 17.06, p: [0, 180, 460], t: [0, 10, 0], fov: 40 },
  ],
}

type Path = { keys: Key[]; pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3 }
const PATHS = {} as Record<SetName, Path>
export function setCamKeys(set: SetName, keys: Key[]) {
  CAM[set] = keys
  PATHS[set] = {
    keys,
    pos: new THREE.CatmullRomCurve3(keys.map((q) => new THREE.Vector3(...q.p)), false, 'centripetal'),
    tgt: new THREE.CatmullRomCurve3(keys.map((q) => new THREE.Vector3(...q.t)), false, 'centripetal'),
  }
}
for (const k of Object.keys(CAM) as SetName[]) setCamKeys(k, CAM[k])

export function camAt(set: SetName, F: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const { keys, pos: cp, tgt: ct } = PATHS[set]
  const n = keys.length
  let i = 0
  while (i < n - 2 && F > keys[i + 1].f) i++
  const a = keys[i]
  const b = keys[i + 1]
  const l = clamp01((F - a.f) / Math.max(1e-6, b.f - a.f))
  const e = l * l * (3 - 2 * l)
  const u = (i + e) / (n - 1)
  cp.getPoint(u, pos)
  ct.getPoint(u, tgt)
  return lerp(a.fov, b.fov, e)
}

/* ------------------------------------------------------- the scale's zoom
   log10 of the view height in metres, keyed to the beats of chapter 1 */
export const ZOOM: [number, number][] = [
  [0, 0.74], [0.62, 0.74], [1.0, 0.62], [1.1, 0.544], [1.14, 0.47],
  [1.22, -0.846], [1.29, -2.347], [1.36, -3.523], [1.42, -4.322], [1.47, -4.857],
  [1.5, -5.25], [1.56, -5.3], [1.62, -6.125], [1.68, -6.6], [1.735, -7.2], [1.79, -7.79],
  [1.835, -8.19], [1.88, -8.65], [1.93, -9.43], [2.0, -9.5],
  // chapter 2 opens by rushing back up to the cell
  [2.1, -4.322], [2.2, -4.322],
]

/* ------------------------------------------------------- the microscopes
   [F start, F end, from mode, to mode]: a wipe from one instrument to the next.
   Modes: 0 fluorescence, 1 brightfield, 2 stained, 3 phase, 4 DIC, 5 confocal, 6 SEM, 7 TEM */
export const WIPES: [number, number, number, number][] = [
  [2.27, 2.3, 0, 1],
  [2.315, 2.345, 1, 2],
  [2.35, 2.38, 2, 3],
  [2.385, 2.415, 3, 4],
  [2.425, 2.455, 4, 0],
  [2.47, 2.5, 0, 5],
  [2.55, 2.585, 5, 6],
  [2.7, 2.735, 6, 7],
  [2.84, 2.875, 7, 0],
]
export const MODE_NAMES = ['Fluorescence', 'Brightfield · unstained', 'Brightfield · stained', 'Phase-contrast', 'Differential interference contrast', 'Confocal', 'Scanning EM', 'Transmission EM']

/* ------------------------------------------------------- the centrifuge
   film time → fractionation stage s ∈ [0, 4]: run j spans s ∈ [j−1, j] */
export const FRAC: [number, number][] = [[3.18, 0], [3.36, 1], [3.41, 1], [3.57, 2], [3.6, 2], [3.73, 3], [3.75, 3], [3.86, 4]]
export const SPIN_G = ['1 000 g · 10 min', '20 000 g · 20 min', '80 000 g · 60 min', '150 000 g · 3 h']
export const PELLETS = ['Nuclei', 'Mitochondria', 'Membranes', 'Ribosomes']

/* ------------------------------------------------------------ film state */
export const film = {
  F: 0,
  chapter: 0,
  u: 0,

  outer: 'scale' as SetName,
  inner: null as SetName | null,
  portal: 0,
  pStyle: 'lens' as 'lens' | 'fade',
  pC: [0.5, 0.5] as [number, number],

  paper: 0,
  exposure: 1,
  vignette: 0.5,

  /* ---- hero & scale ---- */
  hero: 1,
  lensWorld: 0,
  lensR: 0.2,
  lensMag: 2.4,
  lensToCentre: 0,
  headAmt: 1,
  zoom: 0.74,
  pair: 0,

  /* ---- cell ---- */
  organelles: 1,
  cyto: 0.12,
  vesicles: 0,
  memGlow: 0.45,
  flat: 0,
  mode: 0,
  modeB: 0,
  wipe: 0,
  wipeAmt: 0,
  homog: 0,
  frac: 0,
  swing: [0, 0, 0, 0] as number[],
  spin: 0,
  tubeShow: [0, 0, 0, 0] as number[],
  bact: 0,
  cubes: 0,
  split: 0,
  seam: 0,
  villi: 0,
  flag: 0,
  plant: 0,
  dmap: 0,
  mapHi: 0,
  macro: 0,
  engulf: 0,
  digest: 0,
  live: 0,
  /** the cilia are drawn at 1/100 scale: the readout multiplies */
  unitMul: 1,
}
export type Film = typeof film

function spansAt(F: number) {
  return SPANS.filter((s) => F >= s.a && F <= s.b)
}

export function updateFilm(F: number) {
  const f = film
  f.F = F
  f.chapter = Math.min(LAST - 1, Math.floor(F))
  f.u = F - f.chapter

  /* ---- sets & transitions ---- */
  const on = spansAt(F)
  f.outer = on[0]?.set ?? 'scale'
  f.inner = on.length > 1 ? on[1].set : null
  f.portal = 0
  for (const t of TRANS) {
    if (F >= t.a && F <= t.b) {
      f.portal = smooth(t.a, t.b, F)
      f.pStyle = t.style
      f.pC = [t.cx ?? 0.5, t.cy ?? 0.5]
      if (t.reverse && f.inner) {
        // the outer set is the one being returned to: swap so the inner world shrinks away
        const o = f.outer
        f.outer = f.inner
        f.inner = o
        f.portal = 1 - f.portal
      }
    }
  }
  if (!f.inner || f.portal === 0) ((f.inner = null), (f.portal = 0))

  /* ---- hero ---- */
  f.lensToCentre = smooth(0.3, 0.62, F)
  f.lensWorld = smooth(0.42, 0.62, F)
  f.lensR = lerp(0.21, 0.27, smooth(0.3, 0.55, F)) + smooth(0.6, 0.98, F) * 1.0
  f.lensMag = lerp(2.4, 1.0, smooth(0.45, 0.8, F))
  f.headAmt = 1 - smooth(0.55, 0.78, F)
  f.hero = 1 - smooth(0.96, 1.0, F)
  f.zoom = keyed(ZOOM, F)
  f.pair = band(1.47, 1.5, 1.56, 1.6, F)

  /* ---- the cell: entering from the drawing ---- */
  f.flat = 1 - smooth(2.13, 2.24, F)
  f.organelles = 1 - 0.85 * f.dmap * 0
  f.cyto = 0.12
  f.vesicles = 0
  f.memGlow = 0.45

  /* ---- microscopes ---- */
  f.mode = 0
  f.modeB = 0
  f.wipe = 0
  f.wipeAmt = 0
  if (F > 2.2 && F < 2.95) {
    let cur = 0
    for (const [a, b, m0, m1] of WIPES) {
      if (F >= b) cur = m1
      else if (F >= a) {
        f.mode = m0
        f.modeB = m1
        f.wipe = smooth(a, b, F)
        f.wipeAmt = band(a, a + 0.004, b - 0.004, b, F)
        cur = -1
        break
      } else break
    }
    if (cur >= 0) {
      f.mode = cur
      f.modeB = cur
    }
    // confocal beside widefield: the wipe parks halfway
    if (F >= 2.47 && F < 2.55) {
      f.mode = 0
      f.modeB = 5
      f.wipe = keyed([[2.47, 0], [2.5, 0.5], [2.55, 0.5]], F)
      f.wipeAmt = 1 - smooth(2.548, 2.552, F)
      if (F > 2.548) ((f.mode = 5), (f.modeB = 5), (f.wipeAmt = 0))
    }
  }

  /* ---- the centrifuge ---- */
  f.homog = smooth(3.04, 3.17, F) * (1 - smooth(3.94, 4.06, F))
  f.frac = F < 3.18 ? 0 : keyed(FRAC, F, false)
  const s = f.frac
  for (let j = 0; j < 4; j++) {
    const u = s - j
    f.swing[j] = F > 3.9 ? 0 : smooth(0.0, 0.1, u) * (1 - smooth(0.6, 0.7, u))
    f.tubeShow[j] = j === 0 ? smooth(3.02, 3.08, F) : smooth(j - 0.25, j - 0.05, s)
    f.tubeShow[j] *= 1 - smooth(3.93, 4.0, F)
  }
  f.spin = Math.max(...f.swing)

  /* ---- two kinds of cell ---- */
  f.bact = smooth(3.98, 4.04, F) * (1 - smooth(4.94, 5.0, F)) + smooth(17.0, 17.06, F) * (1 - smooth(17.86, 17.96, F))
  f.cubes = band(4.46, 4.52, 4.72, 4.78, F)
  f.split = smooth(4.55, 4.68, F)
  f.seam = smooth(4.52, 4.55, F)
  f.villi = Math.max(smooth(4.74, 4.82, F) * (1 - smooth(5.92, 5.98, F)), band(2.54, 2.57, 2.69, 2.71, F))
  f.flag = band(5.14, 5.2, 5.32, 5.36, F)
  f.plant = Math.max(band(5.36, 5.5, 5.7, 5.8, F), band(10.62, 10.68, 10.76, 10.8, F))

  /* ---- endomembrane review: the flow map ---- */
  f.dmap = smooth(10.81, 10.88, F) * (1 - smooth(10.965, 10.995, F))
  f.mapHi = band(10.9, 10.92, 10.95, 10.97, F)

  /* ---- the macrophage ---- */
  f.macro = smooth(17.02, 17.14, F) * (1 - smooth(17.86, 17.96, F))
  f.engulf = smooth(17.18, 17.4, F)
  f.digest = smooth(17.4, 17.56, F)
  f.live = 0

  /* ---- paper: the flow map, the summary ---- */
  f.paper = Math.max(band(10.85, 10.89, 10.95, 10.98, F), band(17.58, 17.62, 17.72, 17.76, F))

  f.unitMul = (F > 14.0 && F < 14.19) || (F > 14.76 && F < 15.06) ? 100 : 1
  f.exposure = 1
  f.vignette = 0.45
  return f
}

/* the scale readout: world units → metres, per set */
export const UNIT_M: Record<SetName, number> = { scale: 1, cell: 1e-6, in: 1e-8, org: 1e-7, fib: 1e-9, ecm: 1e-8, epi: 1e-7 }
