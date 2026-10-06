/* In-place labels: DOM tags pinned to points in the sets, fading in and out
   with film time, like the callouts on a textbook figure. Numbered ones are
   a sequence (the tour of Figure 4.7).

   The labels also aim the spotlight. At each moment of the film one subject
   is the thing being taught (SPOTS below); when the reader's eye is on a
   bold key term in the copy, that term's label wins instead. Everything
   else on screen dims and softens (engine.spot → the final pass), and in the
   particle cell the structure the term names glows while the rest fades
   (engine.hiMask). */
import * as THREE from 'three'
import { film, band, smooth, type SetName } from '../core/film'
import type { Engine } from '../gl/engine'
import { ANCHORS, BACT_HOME, TUBE, MASK, HEX, T } from '../gl/cell'
import { LADDER } from '../gl/scale'
import { vocab } from './lesson'
import { setLabels } from './labelsets'

export type L = {
  id?: string
  n?: number
  set: SetName
  r: [number, number, number, number]
  at: () => THREE.Vector3
  /** for flat sets: a screen position in px, and whether it is valid */
  scr?: () => [number, number, boolean]
  text: () => string
  c?: string
  left?: boolean
  paper?: boolean
  el?: HTMLElement
  sub?: HTMLElement
  last?: number
  x?: number
  y?: number
  vis?: number
}
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/* what is being taught, moment by moment: [F band], label id, radius in px */
const SPOTS: { r: [number, number, number, number]; id: string; rad: number }[] = [
  { r: [4.02, 4.05, 4.3, 4.33], id: 'bactL', rad: 300 },
  { r: [17.04, 17.08, 17.36, 17.4], id: 'bact', rad: 260 },
]

/* where the bacterium's local points end up (mirrors the cell shader) */
function bactWorld(lx: number, ly: number, lz: number, out: THREE.Vector3, rot = 0.35, pos = BACT_HOME) {
  const c = Math.cos(rot), s = Math.sin(rot)
  let x = c * lx - s * lz
  const z = s * lx + c * lz
  const c2 = Math.cos(0.25), s2 = Math.sin(0.25)
  const y = s2 * x + c2 * ly
  x = c2 * x - s2 * ly
  return out.set(x, y, z).add(pos)
}

export function buildLabels(engine: Engine) {
  const root = document.querySelector<HTMLElement>('[data-labels]')
  if (!root) return () => {}
  const fix = (v: THREE.Vector3) => () => v
  const bw = (x: number, y: number, z: number) => () => bactWorld(x, y, z, new THREE.Vector3())
  const scaleAt = (i: number, ox: number, oy: number) => (): [number, number, boolean] => {
    const s = engine.scale.screen[i]
    return [s.x + ox * s.r, s.y + oy * s.r, s.on && s.r > 0.07 * innerHeight && s.r < 1.2 * innerHeight]
  }
  const tubeAt = (j: number, y: number) => () => V(TUBE.xs[j] + TUBE.R + 0.4, y, 0)
  const LAD_OFF: Record<string, [number, number]> = {
    human: [-0.1, -0.46], chicken: [-0.3, -0.38], frog: [-0.3, -0.36], egg: [-0.3, -0.36], cell: [-0.33, -0.34], nucleus: [-0.12, -0.12],
    bact: [-0.22, -0.3], mito: [0.25, -0.26], myco: [-0.3, -0.33], virus: [-0.33, -0.35], ribo: [-0.32, -0.33], protein: [-0.32, -0.33],
    lipid: [-0.12, -0.46], glucose: [-0.3, -0.3], atom: [-0.22, -0.24],
  }
  const list: L[] = [
    /* the ladder of sizes */
    ...LADDER.map((it, i): L => ({
      id: it.key,
      set: 'scale',
      r: [1.0, 1.03, 2.0, 2.04],
      at: () => V(0, 0, 0),
      scr: scaleAt(i, ...(LAD_OFF[it.key] ?? [0.3, -0.35])),
      text: () => `${it.name} · ${it.sizeText}`,
      left: it.key !== 'mito',
      c: ['#edebe6', '#ffd9a8', '#c7b08a', '#f2c9d6', '#8cf2ff', '#4a6bff', '#59ff73', '#ff3d85', '#9dffb0', '#4de1c1', '#ffd36b', '#b886ff', '#ff9b4a', '#ff6a5a', '#9cc8ff'][i] ?? '#edebe6',
    })),
    { set: 'scale', r: [1.06, 1.09, 1.18, 1.2], at: () => V(0, 0, 0), scr: scaleAt(0, 0.1, -0.06), text: () => 'Nerve cell · up to ≈ 1 m long', c: '#ff4d5a' },

    /* the bacterium (ch 4) */
    { id: 'bactL', set: 'cell', r: [4.03, 4.06, 4.42, 4.46], at: bw(0.2, 0.7, 0), text: () => 'Bacterium · ≈ 2.4 µm', c: '#59ff73' },
    { id: 'b-pm', set: 'cell', r: [4.05, 4.08, 4.32, 4.35], at: bw(-0.6, -0.42, 0.1), text: () => 'Plasma membrane', c: '#8cf2ff', left: true },
    { id: 'b-dna', set: 'cell', r: [4.06, 4.09, 4.32, 4.35], at: bw(0.3, 0.05, 0.3), text: () => 'Nucleoid · DNA, no membrane', c: '#8ad0ff' },
    { id: 'b-ribo', set: 'cell', r: [4.07, 4.1, 4.32, 4.35], at: bw(-0.85, 0.15, 0.25), text: () => 'Ribosomes', c: '#d9ffd0', left: true },
    { id: 'b-wall', set: 'cell', r: [4.17, 4.2, 4.32, 4.35], at: bw(1.1, 0.3, 0.1), text: () => 'Cell wall', c: '#59ff73' },
    { id: 'b-cap', set: 'cell', r: [4.18, 4.21, 4.32, 4.35], at: bw(0.4, 0.6, 0.0), text: () => 'Capsule', c: '#6fd9a0' },
    { id: 'b-fim', set: 'cell', r: [4.19, 4.22, 4.32, 4.35], at: bw(-0.2, -0.75, 0.0), text: () => 'Fimbriae', c: '#59ff73', left: true },
    { id: 'b-flag', set: 'cell', r: [4.2, 4.23, 4.32, 4.35], at: bw(-3.0, 0.1, 0.0), text: () => 'Flagellum', c: '#59ff73', left: true },

    /* the panorama (ch 5): the numbered tour */
    { id: 'nucleus', n: 1, set: 'cell', r: [5.02, 5.05, 5.3, 5.34], at: fix(ANCHORS.nucleus), text: () => 'Nucleus', c: HEX[T.NE] },
    { id: 'ribo', n: 2, set: 'cell', r: [5.03, 5.06, 5.3, 5.34], at: fix(ANCHORS.ribo), text: () => 'Ribosomes', c: HEX[T.RIBO] },
    { id: 'rer', n: 3, set: 'cell', r: [5.04, 5.07, 5.3, 5.34], at: fix(ANCHORS.rer), text: () => 'Rough ER', c: HEX[T.RER], left: true },
    { id: 'golgi', n: 4, set: 'cell', r: [5.05, 5.08, 5.3, 5.34], at: fix(ANCHORS.golgi), text: () => 'Golgi apparatus', c: HEX[T.GOLGI] },
    { id: 'lyso', n: 5, set: 'cell', r: [5.06, 5.09, 5.3, 5.34], at: fix(ANCHORS.lyso), text: () => 'Lysosome', c: HEX[T.LYSO] },
    { id: 'mito', n: 6, set: 'cell', r: [5.07, 5.1, 5.3, 5.34], at: fix(ANCHORS.mito), text: () => 'Mitochondrion', c: HEX[T.MITO] },
    { id: 'perox', n: 7, set: 'cell', r: [5.08, 5.11, 5.3, 5.34], at: fix(ANCHORS.perox), text: () => 'Peroxisome', c: HEX[T.PEROX] },
    { id: 'cyto', n: 8, set: 'cell', r: [5.09, 5.12, 5.3, 5.34], at: fix(ANCHORS.mt), text: () => 'Cytoskeleton · microtubule', c: HEX[T.MT] },
    { id: 'ser', set: 'cell', r: [5.1, 5.13, 5.3, 5.34], at: fix(ANCHORS.ser), text: () => 'Smooth ER', c: HEX[T.SER] },
    { id: 'pm', set: 'cell', r: [5.1, 5.13, 5.3, 5.34], at: fix(ANCHORS.pm), text: () => 'Plasma membrane', c: HEX[T.PM] },
    { id: 'centrosome', set: 'cell', r: [5.15, 5.18, 5.3, 5.34], at: fix(ANCHORS.centrosome), text: () => 'Centrosome', c: '#ffffff' },
    { id: 'flag', set: 'cell', r: [5.16, 5.19, 5.3, 5.34], at: fix(ANCHORS.flag), text: () => 'Flagellum', c: HEX[T.FLAG] },
    { id: 'villi', set: 'cell', r: [5.16, 5.19, 5.3, 5.34], at: fix(ANCHORS.villi), text: () => 'Microvilli', c: HEX[T.VILLI] },
    { id: 'wall', set: 'cell', r: [5.47, 5.5, 5.68, 5.72], at: fix(ANCHORS.wall), text: () => 'Cell wall', c: HEX[T.WALL] },
    { id: 'chloro', set: 'cell', r: [5.48, 5.51, 5.68, 5.72], at: fix(ANCHORS.chloro), text: () => 'Chloroplast', c: HEX[T.CHLORO] },
    { id: 'vac', set: 'cell', r: [5.49, 5.52, 5.68, 5.72], at: fix(ANCHORS.vac), text: () => 'Central vacuole', c: HEX[T.VAC] },
    { id: 'plasmod', set: 'cell', r: [5.5, 5.53, 5.68, 5.72], at: fix(ANCHORS.plasmod), text: () => 'Plasmodesmata', c: HEX[T.WALL] },
    { id: 'vac', set: 'cell', r: [10.68, 10.71, 10.77, 10.8], at: fix(ANCHORS.vac), text: () => 'Central vacuole · cell sap', c: HEX[T.VAC] },

    /* the cells of chapter 4 */
    { id: 'cell', set: 'cell', r: [4.36, 4.39, 4.45, 4.48], at: () => V(-6, 9.5, 2), text: () => 'Eukaryotic cell · ≈ 20 µm', c: HEX[T.PM], left: true },
    { id: 'nucleus', set: 'cell', r: [4.38, 4.41, 4.45, 4.48], at: fix(ANCHORS.nucleus), text: () => 'Nucleus', c: HEX[T.NE] },
    { id: 'villi', set: 'cell', r: [4.76, 4.8, 4.86, 4.9], at: fix(ANCHORS.villi), text: () => 'Microvilli', c: HEX[T.VILLI] },

    /* the centrifuge */
    { set: 'cell', r: [3.06, 3.1, 3.16, 3.19], at: tubeAt(0, 4), text: () => 'Homogenate', c: '#9fb4d0' },
    ...['Nuclei', 'Mitochondria', 'Membranes', 'Ribosomes'].map(
      (p, j): L => ({ set: 'cell', r: [3.27 + j * 0.18 - (j > 0 ? 0.02 : 0), 3.3 + j * 0.18, 3.9, 3.93], at: tubeAt(j, TUBE.y0 - TUBE.R + 0.6), text: () => `Pellet ${j + 1} · ${p}`, c: ['#4a6bff', '#ff3d85', '#44ff7a', '#e8ffe8'][j] }),
    ),
    { set: 'cell', r: [3.84, 3.87, 3.9, 3.93], at: tubeAt(3, 3.5), text: () => 'Supernatant · cytosol', c: '#9fb4d0' },

    /* the macrophage */
    { id: 'macro', set: 'cell', r: [17.06, 17.1, 17.5, 17.54], at: () => V(-6, 7.2, 2), text: () => 'Macrophage', c: HEX[T.PM], left: true },
    { id: 'bact', set: 'cell', r: [17.06, 17.1, 17.4, 17.44], at: () => (engine.cell.mat.uniforms.uBactPos.value as THREE.Vector3).clone().add(V(0, 1, 0)), text: () => (film.digest > 0.5 ? 'Bacterium · being digested' : 'Bacterium'), c: HEX[T.BACT] },
    { id: 'filo', set: 'cell', r: [17.1, 17.14, 17.3, 17.34], at: () => V(12.5, 1.2, 2.2), text: () => 'Filopodia', c: HEX[T.ACTIN] },
    { id: 'lyso', set: 'cell', r: [17.24, 17.28, 17.5, 17.54], at: () => (engine.cell.mat.uniforms.uBactPos.value as THREE.Vector3).clone().add(V(-1.4, -1.4, 0)), text: () => 'Lysosomes fusing', c: HEX[T.LYSO], left: true },
    { id: 'ribo', set: 'cell', r: [17.38, 17.42, 17.54, 17.58], at: fix(ANCHORS.ribo), text: () => 'Ribosomes', c: HEX[T.RIBO] },
    { id: 'nucleus', set: 'cell', r: [17.4, 17.44, 17.54, 17.58], at: fix(ANCHORS.nucleus), text: () => 'Nucleus', c: HEX[T.NE] },
    { id: 'mito', set: 'cell', r: [17.42, 17.46, 17.54, 17.58], at: fix(ANCHORS.mito), text: () => 'Mitochondria · ATP', c: HEX[T.MITO] },
    ...setLabels(engine),
  ]
  for (const l of list) {
    const el = document.createElement('div')
    el.className = 'lab' + (l.left ? ' l' : '') + (l.n ? ' num' : '')
    if (l.c) el.style.setProperty('--c', l.c)
    el.innerHTML = `<i></i><span>${l.n ? `<b>${l.n}</b>` : ''}<em></em></span>`
    root.appendChild(el)
    l.el = el
    l.sub = el.querySelector('em')!
    l.last = -1
  }
  const byId = new Map<string, L[]>()
  for (const l of list) if (l.id) byId.set(l.id, [...(byId.get(l.id) ?? []), l])
  const visibleOf = (id: string) => (byId.get(id) ?? []).reduce<L | null>((b, l) => ((l.vis ?? 0) > (b?.vis ?? 0) ? l : b), null)
  let hot: L | null = null

  return () => {
    const F = film.F
    for (const l of list) {
      let a = band(l.r[0], l.r[1], l.r[2], l.r[3], F)
      if (a < 0.005 || (film.paper > 0.5 && !l.paper)) {
        if (l.last !== 0) ((l.el!.style.opacity = '0'), (l.last = 0))
        l.vis = 0
        continue
      }
      let x: number, y: number, ok: boolean
      if (l.scr) {
        if (film.outer !== l.set || film.portal > 0.02) ok = false
        ;[x, y, ok] = l.scr()
        if (film.outer !== l.set || film.portal > 0.02) ok = false
      } else [x, y, ok] = engine.project(l.set, l.at())
      if (!ok || x < -50 || y < -50 || x > innerWidth + 50 || y > innerHeight + 50) a = 0
      l.x = x
      l.y = y
      l.vis = a
      l.el!.style.opacity = a.toFixed(3)
      l.last = a
      l.el!.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${l.left ? '-100%' : '0'}, -50%)`
      const t = l.text()
      if (l.sub!.textContent !== t) l.sub!.textContent = t
    }

    /* the spotlight: the key term being read wins, then the moment's subject */
    let target: L | null = null
    let amt = 0
    let rad = 280
    const vk = vocab.active ? visibleOf(vocab.active) : null
    if (vk && (vk.vis ?? 0) > 0.5) ((target = vk), (amt = 0.85 * vocab.strength), (rad = 260))
    else
      for (const s of SPOTS) {
        const w = band(s.r[0], s.r[1], s.r[2], s.r[3], F)
        const l = visibleOf(s.id)
        if (w > amt && l && (l.vis ?? 0) > 0.3) ((target = l), (amt = w * 0.85), (rad = s.rad))
      }
    if (target !== hot) {
      hot?.el!.classList.remove('hot')
      target?.el!.classList.add('hot')
      hot = target
    }
    if (target) {
      engine.spot.x = target.x!
      engine.spot.y = target.y!
      engine.spot.r = rad * (innerHeight / 900)
    }
    engine.spot.amt = target ? amt * smooth(0, 1, 1 - film.paper) : 0

    /* in the particle cell, the structure the key term names glows */
    const m = film.outer === 'cell' && vocab.active ? MASK[vocab.active] ?? 0 : 0
    engine.hiMask = m
    engine.hiAmt = m ? 0.9 * vocab.strength : 0
  }
}
