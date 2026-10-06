/* The lesson layer: what turns the film into something you learn from.
     vocab       bold key terms light up one after another as a card is read,
                 and point the spotlight at the thing they name (labels.ts)
     takeaways   each chapter ends on three lines that assemble from nothing
     map         the concept summary laid over the flattened cell
   All of it is a function of film time, so it reverses on scroll-up. */
import { SplitText } from 'gsap/SplitText'
import { film, band, smooth, clamp01 } from '../core/film'
import type { Engine } from '../gl/engine'

/** the key term being read now, and how firmly (read by the labels) */
export const vocab = { active: '' as string, strength: 0 }

export function buildLesson(engine: Engine | null) {
  void engine
  /* ---- vocab: terms per beat, lit in reading order ---- */
  type Term = { el: HTMLElement; key: string }
  type Card = { el: HTMLElement; n: number; a: number; b: number; terms: Term[] }
  const cards: Card[] = []
  let hover: Term | null = null
  document.querySelectorAll<HTMLElement>('section.chapter').forEach((sec) => {
    const n = parseFloat(sec.dataset.f0!)
    sec.querySelectorAll<HTMLElement>('.beat').forEach((el) => {
      const [a, b] = el.dataset.at!.split(',').map(Number)
      const terms = Array.from(el.querySelectorAll<HTMLElement>('b.k')).map((t) => ({ el: t, key: t.dataset.k || '' }))
      terms.forEach((t) => {
        t.el.addEventListener('pointerenter', () => (hover = t))
        t.el.addEventListener('pointerleave', () => hover === t && (hover = null))
      })
      if (terms.length) cards.push({ el, n, a, b, terms })
    })
  })

  /* ---- takeaways: words drift in from scattered positions ---- */
  type Take = { el: HTMLElement; n: number; a: number; b: number; words: { el: HTMLElement; dx: number; dy: number; r: number; d: number }[]; last: number }
  const takes: Take[] = []
  document.querySelectorAll<HTMLElement>('[data-take]').forEach((el, k) => {
    const sec = el.closest('section')!
    const n = parseFloat(sec.dataset.f0!)
    const [a, b] = el.dataset.take!.split(',').map(Number)
    const split = SplitText.create(el.querySelectorAll('li > span, .tk-h'), { type: 'words' })
    const words = (split.words as HTMLElement[]).map((w, i) => {
      const h = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
      const f = h - Math.floor(h)
      const g = (Math.sin(i * 4.1 + k) + 1) / 2
      return { el: w, dx: (f - 0.5) * 520, dy: (g - 0.5) * 360, r: (f - 0.5) * 50, d: (i / Math.max(1, split.words.length)) * 0.5 }
    })
    takes.push({ el, n, a, b, words, last: -1 })
  })

  /* ---- the concept summary ---- */
  const map = document.querySelector<HTMLElement>('[data-map]')
  const mapRows = map ? Array.from(map.querySelectorAll<HTMLElement>('[data-row]')) : []
  const mapCols = map ? Array.from(map.querySelectorAll<HTMLElement>('.map-col')) : []

  let lastMap = -1
  return () => {
    const F = film.F

    /* vocab */
    let best: Term | null = null
    let strength = 0
    for (const c of cards) {
      const u = F - c.n
      const vis = band(c.a, c.a + 0.02, c.b - 0.02, c.b, u)
      if (vis < 0.02) {
        for (const t of c.terms) t.el.classList.remove('on', 'seen')
        continue
      }
      // read in order: the first term lights as the card arrives, the last before it leaves
      const p = clamp01((u - c.a - 0.01) / Math.max(0.02, c.b - c.a - 0.05))
      const i = Math.min(c.terms.length - 1, Math.floor(p * c.terms.length))
      c.terms.forEach((t, k) => {
        t.el.classList.toggle('on', k === i)
        t.el.classList.toggle('seen', k < i)
      })
      if (vis > strength) ((best = c.terms[i]), (strength = vis))
    }
    if (hover) ((best = hover), (strength = 1))
    vocab.active = best?.key ?? ''
    vocab.strength = strength

    /* takeaways */
    for (const t of takes) {
      const u = F - t.n
      const p = band(t.a, t.a + 0.035, 1.5, 1.6, u)
      const q = Math.round(p * 300) / 300
      if (q === t.last) continue
      t.last = q
      t.el.style.opacity = String(Math.min(1, q * 3))
      t.el.style.visibility = q < 0.003 ? 'hidden' : 'visible'
      for (const w of t.words) {
        const k = smooth(w.d, w.d + 0.5, q)
        w.el.style.transform = `translate3d(${(w.dx * (1 - k)).toFixed(1)}px, ${(w.dy * (1 - k)).toFixed(1)}px, 0) rotate(${(w.r * (1 - k)).toFixed(1)}deg)`
        w.el.style.opacity = k.toFixed(3)
      }
    }

    /* the concept summary on paper */
    if (map) {
      const k = band(17.6, 17.64, 17.72, 17.75, F)
      const q = Math.round(k * 200) / 200
      if (q !== lastMap) {
        lastMap = q
        map.style.opacity = String(q)
        map.style.visibility = q < 0.01 ? 'hidden' : 'visible'
      }
      if (q > 0) {
        mapRows.forEach((r, i) => {
          const a = smooth(17.62 + i * 0.006, 17.64 + i * 0.006, F)
          r.style.opacity = a.toFixed(3)
          r.style.transform = `translate3d(0, ${((1 - a) * 12).toFixed(1)}px, 0)`
        })
        const col = F < 17.66 ? 0 : F < 17.685 ? 1 : F < 17.705 ? 2 : 3
        mapCols.forEach((c, i) => c.classList.toggle('on', i === col))
      }
    }
  }
}
