/* The DOM half of the film: which copy block is on screen, which instrument
   is lit, the chrome, the paper swap. Everything is a function of film time,
   so it reverses exactly on scroll-up. */
import { film, band, smooth, CHAPTERS, MODE_NAMES } from '../core/film'
import { scroll, scrollToF } from '../core/scroll'

type Beat = { el: HTMLElement; a: number; b: number; last: number }
type Chapter = { n: number; beats: Beat[]; inst: HTMLElement | null; lastInst: number; take: [number, number] | null }

export function buildChoreo(scaleText: () => string) {
  const chapters: Chapter[] = []
  document.querySelectorAll<HTMLElement>('section.chapter').forEach((sec) => {
    const n = parseFloat(sec.dataset.f0!)
    const beats: Beat[] = []
    sec.querySelectorAll<HTMLElement>('.beat').forEach((el) => {
      const [a, b] = el.dataset.at!.split(',').map(Number)
      beats.push({ el, a, b, last: -1 })
    })
    const tk = sec.querySelector<HTMLElement>('[data-take]')
    chapters.push({ n, beats, inst: sec.querySelector('.inst'), lastInst: -1, take: tk ? (tk.dataset.take!.split(',').map(Number) as [number, number]) : null })
  })

  const scaleEl = document.querySelector('[data-scale-bar]')
  const chnum = document.querySelector('[data-chnum]')
  const chname = document.querySelector('[data-chname]')
  const fill = document.querySelector<HTMLElement>('.rail-fill')
  const hero = document.querySelector<HTMLElement>('#hero .sticky')
  const megas = Array.from(document.querySelectorAll<HTMLElement>('.mega, .vn-line'))
  const scopeTag = document.querySelector<HTMLElement>('[data-scope]')
  const scopeA = document.querySelector<HTMLElement>('[data-scope-a]')
  const scopeB = document.querySelector<HTMLElement>('[data-scope-b]')
  const root = document.documentElement

  const rail = document.querySelector('.rail-line')!
  const ticks = CHAPTERS.map((name, i) => {
    const b = document.createElement('button')
    b.className = 'rail-tick'
    b.dataset.label = `${String(i).padStart(2, '0')} ${name}`
    b.setAttribute('aria-label', `Go to ${name}`)
    b.addEventListener('click', () => (i === 0 ? scroll.lenis?.scrollTo(0, { duration: 2.2 }) : scrollToF(i + 0.001)))
    rail.appendChild(b)
    return b
  })
  const placeTicks = () => {
    for (let i = 0; i < ticks.length; i++) {
      const s = scroll.sections.find((q) => q.f0 === i && q.el.classList.contains(i === 0 ? 'hero' : 'chapter'))
      if (s) ticks[i].style.top = `${((s.top / scroll.max) * 100).toFixed(2)}%`
    }
  }
  placeTicks()
  addEventListener('resize', () => requestAnimationFrame(placeTicks))
  document.fonts?.ready.then(placeTicks)
  document.querySelectorAll<HTMLElement>('[data-to]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault()
      scroll.lenis?.scrollTo(0, { duration: 3 })
    }),
  )

  let lastPaper = -1
  let lastCh = -1
  let skew = 0
  let lastScale = ''
  let frame = 0
  let lastScope = ''
  let brightE = 0
  return () => {
    const F = film.F
    frame++
    for (const c of chapters) {
      const u = F - c.n
      if (u < -0.3 || u > 1.3) {
        for (const b of c.beats) if (b.last !== 0) ((b.last = 0), (b.el.style.opacity = '0'), (b.el.style.visibility = 'hidden'))
        if (c.inst && c.lastInst !== 0) ((c.lastInst = 0), (c.inst.style.opacity = '0'), (c.inst.style.visibility = 'hidden'))
        continue
      }
      for (const b of c.beats) {
        const a0 = b.a <= 0.001 ? -0.2 : b.a
        const b1 = b.b >= 0.999 ? 1.2 : b.b
        const al = band(a0, a0 + 0.025, b1 - 0.025, b1, u)
        const q = Math.round(al * 200) / 200
        if (q === b.last) continue
        b.last = q
        const dir = u < (b.a + b.b) / 2 ? 1 : -1
        b.el.style.opacity = String(q)
        b.el.style.visibility = q < 0.005 ? 'hidden' : 'visible'
        b.el.style.transform = `translate3d(0, ${((1 - q) * 22 * dir).toFixed(1)}px, 0)`
      }
      if (c.inst) {
        let al = band(-0.12, 0.04, 0.96, 1.08, u)
        if (c.take) al *= 1 - smooth(c.take[0] - 0.03, c.take[0], u)
        // the panel steps aside wherever the scene itself becomes the diagram
        if (c.n === 10) al *= 1 - smooth(0.78, 0.81, u)
        if (c.n === 17) al *= 1 - band(0.54, 0.57, 0.72, 0.75, u)
        const q = Math.round(al * 200) / 200
        if (q !== c.lastInst) {
          c.lastInst = q
          c.inst.style.opacity = String(q)
          c.inst.style.visibility = q < 0.005 ? 'hidden' : 'visible'
          c.inst.style.setProperty('--ix', `${((1 - q) * 24).toFixed(1)}px`)
        }
      }
    }

    /* chrome */
    if (frame % 6 === 0 && scaleEl) {
      const t = scaleText()
      if (t !== lastScale) scaleEl.textContent = lastScale = t
    }
    if (film.chapter !== lastCh) {
      lastCh = film.chapter
      if (chnum) chnum.textContent = String(film.chapter).padStart(2, '0')
      if (chname) chname.textContent = CHAPTERS[film.chapter]
      ticks.forEach((t, i) => t.classList.toggle('on', i === film.chapter))
    }
    if (fill) fill.style.transform = `scaleY(${(scroll.y / scroll.max).toFixed(4)})`
    if (hero) hero.style.opacity = (1 - smooth(0.3, 0.52, F)).toFixed(3)

    /* which microscope is on each side of the wipe */
    if (scopeTag) {
      const on = film.outer === 'cell' && F > 2.25 && F < 2.9 && (film.mode > 0 || film.modeB > 0 || film.wipeAmt > 0)
      const key = on ? `${film.mode}|${film.modeB}|${film.wipeAmt > 0 ? 1 : 0}` : ''
      if (key !== lastScope) {
        lastScope = key
        scopeTag.classList.toggle('on', on)
        if (on) {
          const split = film.modeB !== film.mode
          // left of the wipe is the new instrument, right the old
          scopeA!.textContent = MODE_NAMES[split ? film.modeB : film.mode]
          scopeB!.textContent = split ? MODE_NAMES[film.mode] : ''
          scopeB!.style.visibility = split ? 'visible' : 'hidden'
          const bright = [1, 2, 3, 4, 7].includes(split ? film.modeB : film.mode)
          scopeTag.classList.toggle('light', bright)
        }
      }
    }

    /* paper plates turn the page itself to paper; so do the bright-field microscopes */
    const brightM = (m: number) => m >= 1 && m <= 4 || m === 7
    const bright = film.outer === 'cell' && F > 2.2 && F < 2.95 ? (brightM(film.mode) && brightM(film.modeB) ? 1 : brightM(film.mode) || brightM(film.modeB) ? 0.6 : 0) : 0
    brightE += (bright - brightE) * 0.25
    root.classList.toggle('scope-light', brightE > 0.5)
    const p = Math.round(Math.max(film.paper, brightE) * 100) / 100
    if (p !== lastPaper) {
      lastPaper = p
      root.style.setProperty('--paper', String(p))
      document.body.style.background = p > 0 ? `color-mix(in oklab, #ece7dc ${p * 100}%, #07080a)` : ''
    }

    skew += (Math.max(-1, Math.min(1, scroll.velN)) * -3 - skew) * 0.12
    const s = skew.toFixed(2)
    for (const m of megas) m.style.transform = `skewY(${s}deg)`
  }
}
