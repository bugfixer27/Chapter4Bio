/* The instruments: hairline panels whose readings come from the same model
   and the same film as the scene. */
import { film, smooth, band, clamp01, keyed, FRAC, MODE_NAMES } from '../core/film'
import { FILAMENTS, SPINS, BIG, SMALL, KINESIN_STEP_NM, PH } from '../science/cell'
import { LADDER } from '../gl/scale'
import { insideStage, fibStage, epiStage } from '../core/stages'
import type { Engine } from '../gl/engine'

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s) as T | null
const $$ = <T extends Element = HTMLElement>(s: string) => Array.from(document.querySelectorAll<T>(s))
const NS = 'http://www.w3.org/2000/svg'
const svgEl = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent?.appendChild(e)
  return e
}
const setText = (el: Element | null, t: string) => {
  if (el && el.textContent !== t) el.textContent = t
}
const lit = (els: Element[], on: (i: number, el: Element) => boolean) => els.forEach((e, i) => e.classList.toggle('on', on(i, e)))
const fmtG = (g: number) => (g < 1 ? '0 g' : `${Math.round(g).toLocaleString('en-GB').replace(/,/g, ' ')} g`)

export function buildInstruments(engine: Engine | null) {
  /* ---- ch1: the log ruler, 10 m → 0.1 nm ---- */
  const ruler = $('[data-ruler]')
  const ZTOP = 1, ZBOT = -10
  const yOf = (log10m: number) => ((ZTOP - log10m) / (ZTOP - ZBOT)) * 100
  let now: HTMLElement | null = null
  const objEls: HTMLElement[] = []
  if (ruler) {
    ruler.insertAdjacentHTML('beforeend', '<div class="axis"></div>')
    const units: [number, string][] = [[1, '10 m'], [0, '1 m'], [-1, '0.1 m'], [-2, '1 cm'], [-3, '1 mm'], [-4, '100 µm'], [-5, '10 µm'], [-6, '1 µm'], [-7, '100 nm'], [-8, '10 nm'], [-9, '1 nm'], [-10, '0.1 nm']]
    for (const [z, t] of units) ruler.insertAdjacentHTML('beforeend', `<span class="tick mono" style="top:${yOf(z)}%">${t}</span>`)
    // the band where most cells live, 1–100 µm
    ruler.insertAdjacentHTML('beforeend', `<span class="bandz" style="top:${yOf(-4)}%;height:${yOf(-6) - yOf(-4)}%"></span>`)
    // what each instrument can resolve
    const res: [number, number, string, string][] = [[0, -4, 'Eye', '#edebe6'], [-4, -6.7, 'Light', '#59e1ff'], [-6.7, -7.85, 'Super-res', '#b886ff'], [-7.85, -8.7, 'Electron', '#ffb347']]
    res.forEach(([a, b, t, c], i) => ruler.insertAdjacentHTML('beforeend', `<span class="res" style="top:${yOf(a)}%;height:${yOf(b) - yOf(a)}%;background:${c};left:${44 - i * 0}px"><b>${t}</b></span>`))
    LADDER.forEach((it) => {
      ruler.insertAdjacentHTML('beforeend', `<span class="obj mono" style="top:${yOf(Math.log10(it.size))}%"><i></i>${it.name}</span>`)
      objEls.push(ruler.lastElementChild as HTMLElement)
    })
    ruler.insertAdjacentHTML('beforeend', '<span class="now mono" data-t=""></span>')
    now = ruler.lastElementChild as HTMLElement
  }

  /* ---- ch2: resolution, two points closing in, through light and electrons ---- */
  const rc = $<HTMLCanvasElement>('[data-res]')
  const rctx = rc?.getContext('2d') ?? null
  const resD = $('[data-res-d]')
  const resLM = $('[data-res-lm]')
  const resEM = $('[data-res-em]')
  const modes = $$('[data-modes] li')
  const drawRes = (sepNm: number) => {
    if (!rc || !rctx) return
    const W = rc.width, H = rc.height
    const img = rctx.createImageData(W, H)
    // left half: light (blur σ ≈ 85 nm, so two points merge below ≈ 200 nm); right half: electrons (σ ≈ 0.85 nm)
    const nmPerPx = 900 / (W / 2)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const half = x < W / 2 ? 0 : 1
        const lx = (x - (half ? W * 0.75 : W * 0.25)) * nmPerPx * (half ? 0.01 : 1)
        const ly = (y - H / 2) * nmPerPx * (half ? 0.01 : 1)
        const sig = half ? 0.85 : 85
        const sep = sepNm / 2
        const g = Math.exp(-((lx - sep) ** 2 + ly ** 2) / (2 * sig * sig)) + Math.exp(-((lx + sep) ** 2 + ly ** 2) / (2 * sig * sig))
        const v = Math.min(1, g * 0.85)
        const i = (y * W + x) * 4
        img.data[i] = (half ? 255 : 120) * v
        img.data[i + 1] = (half ? 200 : 230) * v
        img.data[i + 2] = (half ? 120 : 255) * v
        img.data[i + 3] = 255
      }
    }
    rctx.putImageData(img, 0, 0)
    rctx.fillStyle = 'rgba(237,235,230,0.5)'
    rctx.fillRect(W / 2, 0, 1, H)
    rctx.font = '20px "Geist Mono Variable", monospace'
    rctx.fillStyle = 'rgba(237,235,230,0.75)'
    rctx.fillText('LIGHT', 12, 26)
    rctx.fillText('ELECTRONS (×100 zoom)', W / 2 + 12, 26)
  }
  let lastSep = -1

  /* ---- ch5: the colour key ---- */
  const keycols = $('[data-keycols]')
  if (keycols) {
    const k: [string, string][] = [['#8cf2ff', 'Plasma membrane'], ['#4a6bff', 'Nucleus'], ['#44ff7a', 'Rough ER'], ['#80f2c0', 'Smooth ER'], ['#ffa82e', 'Golgi'], ['#ff3d85', 'Mitochondria'], ['#ff4d33', 'Lysosomes'], ['#fff06a', 'Peroxisomes'], ['#c4ff4d', 'Microtubules'], ['#ff6b2e', 'Actin'], ['#dfff6a', 'Chloroplasts'], ['#c8b4ff', 'Vacuole']]
    keycols.innerHTML = k.map(([c, t]) => `<li><i style="background:${c}"></i>${t}</li>`).join('')
  }

  /* ---- ch9: one glycoprotein's sugar tree, trimmed and rebuilt cis → trans ---- */
  const gs = $<SVGSVGElement>('[data-glyco]')
  const gNodes: SVGElement[] = []
  if (gs) {
    svgEl('rect', { x: 128, y: 92, width: 44, height: 22, rx: 6, fill: 'rgba(255,211,107,0.18)', stroke: '#ffd36b' }, gs)
    svgEl('text', { x: 150, y: 107, 'text-anchor': 'middle' }, gs).textContent = 'protein'
    // a branched tree: 14 positions
    const P: [number, number, number][] = [[150, 80, -1], [150, 66, 0], [150, 52, 1], [126, 40, 2], [174, 40, 2], [110, 28, 3], [126, 24, 3], [174, 24, 4], [190, 28, 4], [100, 14, 5], [126, 10, 6], [174, 10, 7], [200, 14, 8], [150, 30, 2]]
    P.forEach(([x, y, par]) => {
      if (par >= 0) svgEl('line', { x1: x, y1: y, x2: P[par][0], y2: P[par][1], stroke: 'rgba(237,235,230,0.35)' }, gs)
    })
    P.forEach(([x, y]) => gNodes.push(svgEl('circle', { cx: x, cy: y, r: 5, fill: '#59e1ff', stroke: 'rgba(0,0,0,0.4)' }, gs)))
  }
  const gsteps = $$('[data-gsteps] li')

  /* ---- ch13: Table 4.1, drawn to scale ---- */
  const fib = $('[data-fibres]')
  const fibCols = ['#c4ff4d', '#ff6b2e', '#b886ff']
  if (fib)
    FILAMENTS.forEach((f, i) => {
      fib.insertAdjacentHTML(
        'beforeend',
        `<div class="fibre" style="--c:${fibCols[i]};--d:${(f.d / 25) * 18 + 2}px"><span class="n mono">${f.name} · ${f.prot}</span><span class="d mono">${f.dText}</span><i class="fbar"></i><span class="r mono">${f.role}</span></div>`,
      )
    })

  /* ---- readouts ---- */
  const R = {
    g: $('[data-g]'),
    pellets: $$('[data-pellets] li'),
    svS: $('[data-sv="s"]'),
    svR: $('[data-sv="r"]'),
    pano: $$('[data-pano] > div'),
    ladder: $$('[data-ladder] li'),
    aa: $('[data-ribo="aa"]'),
    sug: $('[data-ribo="sug"]'),
    caIn: $('[data-ca-in]'),
    caOut: $('[data-ca-out]'),
    caInT: $('[data-ca-in-t]'),
    caOutT: $('[data-ca-out-t]'),
    ser: $('[data-ser]'),
    phL: $('[data-ph-l]'),
    phC: $('[data-ph-c]'),
    lysoN: $('[data-lyso="n"]'),
    lysoM: $('[data-lyso="m"]'),
    evid: $$('[data-evid] li'),
    gen: $('[data-gen]'),
    react: $('[data-react]'),
    steps: $('[data-fib="steps"]'),
    atp: $('[data-fib="atp"]'),
    nm: $('[data-fib="nm"]'),
    links: $('[data-links]'),
    slide: $('[data-slide]'),
    sig: $$('[data-sig] li'),
    junc: $$('[data-junc] > div'),
    dyeLeak: $('[data-dye="leak"]'),
    dyeN: $('[data-dye="n"]'),
    route: $$('[data-route] li'),
  }
  // pH bar: 0 … 14 across
  const phX = (ph: number) => `${(ph / 14) * 100}%`
  if (R.phL) R.phL.style.left = phX(PH.lysosome)
  if (R.phC) R.phC.style.left = phX(PH.cytosol)

  return (_dt: number) => {
    const F = film.F
    const ch = film.chapter
    const u = film.u

    if (ch === 1 || (ch === 0 && u > 0.9) || (ch === 2 && u < 0.12)) {
      const Z = film.zoom
      if (now) {
        now.style.top = `${clamp01((ZTOP - Z) / (ZTOP - ZBOT)) * 100}%`
        now.dataset.t = engine ? engine.scaleText() : ''
      }
      objEls.forEach((e, i) => e.classList.toggle('on', Math.abs(Math.log10(LADDER[i].size / 0.4) - Z) < 0.45))
    }
    if (ch === 2) {
      // the two points close from 400 nm to 2 nm across the resolution beat
      const sep = Math.round(keyed([[2.14, 420], [2.22, 160], [2.26, 25], [2.3, 4]], F))
      if (sep !== lastSep) {
        lastSep = sep
        drawRes(sep)
        setText(resD, String(sep))
        if (resLM) {
          resLM.textContent = sep >= 200 ? 'Light: two' : 'Light: one blur'
          resLM.classList.toggle('merge', sep < 200)
        }
        if (resEM) {
          resEM.textContent = sep >= 2 ? 'Electrons: two' : 'Electrons: one'
          resEM.classList.toggle('merge', sep < 2)
        }
      }
      const m = film.wipeAmt > 0 ? film.modeB : film.mode
      modes.forEach((e) => e.classList.toggle('on', Number((e as HTMLElement).dataset.m) === m && F > 2.26))
      void MODE_NAMES
    }
    if (ch === 3) {
      // g-force rises and falls with each run's swing
      let g = 0
      for (let j = 0; j < 4; j++) g = Math.max(g, film.swing[j] * SPINS[j].g)
      setText(R.g, fmtG(g))
      const s = film.frac
      R.pellets.forEach((e, j) => {
        e.classList.toggle('on', s > j && s < j + 1)
        e.classList.toggle('done', s >= j + 0.7)
      })
      void FRAC
    }
    if (ch === 4) {
      const sp = film.split
      const surf = Math.round(BIG.surface + (SMALL.surface - BIG.surface) * smooth(0.1, 0.9, sp))
      setText(R.svS, String(surf))
      setText(R.svR, (surf / BIG.volume).toFixed(1))
    }
    if (ch === 5) {
      const plant = film.plant
      R.pano.forEach((e) => {
        const g = (e as HTMLElement).dataset.g
        e.classList.toggle('on', (g === 'p' && plant > 0.5) || (g === 'a' && u > 0.14 && u < 0.3) || (g === 'b' && u > 0.6 && u < 0.74))
        e.classList.toggle('off', g === 'a' && plant > 0.5)
      })
    }
    if (ch === 6) {
      const c = insideStage(F, 0).st.chromC
      lit(R.ladder, (i) => (u > 0.42 && u < 0.6 ? i === 1 : c > 0 ? Math.round(c) + 1 === i || (c > 2.9 && i === 4) : false))
    }
    if (ch === 7) {
      const st = insideStage(F, 0).st
      setText(R.aa, String(Math.floor((u < 0.34 ? st.transl : st.transl + 1) * 46 * (u < 0.34 ? 1 : 1))))
      setText(R.sug, String(Math.floor(st.glyco * 11)))
    }
    if (ch === 8) {
      const st = insideStage(F, 0).st
      const inK = st.caIn * (1 - st.caOut)
      if (R.caIn) (R.caIn as HTMLElement).style.transform = `scaleX(${(0.15 + 0.85 * inK).toFixed(3)})`
      if (R.caOut) (R.caOut as HTMLElement).style.transform = `scaleX(${(0.85 - 0.75 * inK + (st.caOut > 0 ? 0.0 : 0)).toFixed(3)})`
      setText(R.caInT, inK > 0.5 ? 'Lumen: high' : 'Lumen: low')
      setText(R.caOutT, inK > 0.5 ? 'Cytosol: low' : st.caOut > 0.5 ? 'Cytosol: flood → contraction' : 'Cytosol: high')
      setText(R.ser, `${st.ser.toFixed(1)}×`)
    }
    if (ch === 9) {
      // the tree's composition by stage: ER core → trimmed in cis → rebuilt → finished
      const k = keyed([[9.17, 0], [9.22, 1], [9.27, 2], [9.31, 3], [9.6, 3], [9.7, 4]], F)
      const vis = [14, 9, 12, 14, 14][Math.round(k)]
      const colr = (i: number) => (k < 1.5 ? '#59e1ff' : i < 3 ? '#59e1ff' : k < 2.5 ? (i < 9 ? '#8dff7a' : '#ffe066') : i % 3 === 0 ? '#ff7ab0' : i < 9 ? '#8dff7a' : '#ffe066')
      gNodes.forEach((n, i) => {
        n.setAttribute('opacity', i < vis ? '1' : '0.08')
        n.setAttribute('fill', colr(i))
      })
      gsteps.forEach((e, i) => {
        e.classList.toggle('on', Math.round(k) === i)
        e.classList.toggle('done', Math.round(k) > i)
      })
    }
    if (ch === 10) {
      const st = insideStage(F, 0).u
      setText(R.lysoN, String(Math.floor(st.digest * 1 + st.autoFuse * 1)))
      setText(R.lysoM, String(Math.floor((st.digest + st.autoFuse) * 180)))
    }
    if (ch === 11) {
      lit(R.evid, (i) => u > 0.6 + i * 0.04)
      setText(R.gen, String(Math.round(keyed([[11.3, 0], [11.36, 1], [11.4, 2], [11.7, 2], [11.78, 3]], F) * 10) / 10))
    }
    if (ch === 12) R.react?.classList.toggle('on', u > 0.77)
    if (ch === 13) {
      const st = fibStage(F)
      const n = Math.floor(st.walk * 15 * 1.6)
      setText(R.steps, String(n))
      setText(R.atp, String(n))
      setText(R.nm, `${n * KINESIN_STEP_NM} nm`)
    }
    if (ch === 14) {
      const st = fibStage(F)
      setText(R.links, st.links > 0.5 ? 'Intact' : 'Cut')
      setText(R.slide, st.links > 0.5 ? (st.bend > 0.1 ? 'Bend' : 'Held') : st.slideAmt > 0.1 ? 'Slide apart' : 'Held')
    }
    if (ch === 15) lit(R.sig, (i) => film.F > 15.72 + i * 0.04 && film.F < 15.95)
    if (ch === 16) {
      const e = epiStage(F)
      lit(R.junc, (i) => (i === 0 ? u < 0.18 : e.hi === i))
      setText(R.dyeLeak, e.dyeTop > 0.05 ? 'blocked by tight junctions' : 'no dye yet')
      const reached = e.dye <= 0 ? 1 : 1 + Math.floor(e.dye * 3.2) * 6
      setText(R.dyeN, String(Math.min(37, reached)))
    }
    if (ch === 17) {
      const order = u < 0.12 ? 0 : u < 0.2 ? 1 : u < 0.36 ? 2 : u < 0.43 ? 3 : u < 0.49 ? 4 : 5
      lit(R.route, (i) => i <= order)
    }
    void band
  }
}
