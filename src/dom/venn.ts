/* Sort it out. A sentence of cell parts becomes a pile of rigid bodies:
   each word lets go in turn, steers toward the bin it belongs in (prokaryotes
   only, both, eukaryotes only; or endomembrane system / not) and stacks
   there. Scroll on and they spring back into the sentence. The cursor shoves
   whatever it touches. Everything is keyed to the section's scroll progress,
   so scrolling back reverses the sort. */
import { scroll } from '../core/scroll'

type Body = { el: HTMLElement; bin: number; hx: number; hy: number; w: number; h: number; x: number; y: number; vx: number; vy: number; a: number; va: number; delay: number; tx: number }
type Venn = { root: HTMLElement; sec: string; bodies: Body[]; bins: HTMLElement[]; width: number; height: number; binX: [number, number][]; floor: number; measure: () => void }

export function buildVenn() {
  const list: Venn[] = []
  document.querySelectorAll<HTMLElement>('[data-venn]').forEach((root) => {
    const line = root.querySelector<HTMLElement>('.vn-line')!
    const binsEl = root.querySelector<HTMLElement>('.vn-bins')!
    const bins = Array.from(binsEl.querySelectorAll<HTMLElement>('.vn-bin'))
    const sec = root.closest('section')!.id
    const bodies: Body[] = Array.from(line.querySelectorAll<HTMLElement>('span')).map((s, i) => {
      s.classList.add('vn-word')
      const bin = Number(s.dataset.bin)
      s.classList.add('b' + bin)
      return { el: s, bin, hx: 0, hy: 0, w: 0, h: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, delay: i * 0.035, tx: 0 }
    })
    const v: Venn = {
      root, sec, bodies, bins, width: 0, height: 0, binX: [], floor: 0,
      measure: () => {
        for (const b of bodies) b.el.style.transform = ''
        const r = root.getBoundingClientRect()
        v.width = r.width
        v.height = r.height
        v.floor = r.height - 6
        v.binX = bins.map((bn) => {
          const q = bn.getBoundingClientRect()
          return [q.left - r.left, q.right - r.left] as [number, number]
        })
        // where each word aims: spread across its bin in reading order
        const count = bins.map(() => 0)
        const per = bins.map((_, k) => bodies.filter((b) => b.bin === k).length)
        for (const b of bodies) {
          b.hx = b.el.offsetLeft
          b.hy = b.el.offsetTop
          b.w = b.el.offsetWidth
          b.h = b.el.offsetHeight
          const [l, rr] = v.binX[b.bin] ?? [0, r.width]
          const k = count[b.bin]++
          const span = rr - l - b.w - 24
          b.tx = l + 12 + (per[b.bin] > 1 ? (span * ((k * 0.618) % 1)) : span / 2)
        }
      },
    }
    v.measure()
    addEventListener('resize', v.measure)
    document.fonts?.ready.then(v.measure)
    list.push(v)
  })

  let mx = -1e4, my = -1e4, mvx = 0, mvy = 0
  addEventListener('pointermove', (e) => {
    mvx = e.clientX - mx
    mvy = e.clientY - my
    mx = e.clientX
    my = e.clientY
  })

  return (dt: number) => {
    dt = Math.min(dt, 1 / 30)
    for (const v of list) {
      const sec = scroll.sections.find((s) => s.id === v.sec)
      if (!sec || sec.vis < 0.02) continue
      const u = sec.p
      const home = u < 0.14 || u > 0.88
      v.root.classList.toggle('open', u > 0.08 && u < 0.94)
      const rr = v.root.getBoundingClientRect()
      const lmx = mx - rr.left
      const lmy = my - rr.top
      for (const b of v.bodies) {
        const active = !home && u > 0.14 + b.delay * 0.6
        if (active) {
          b.vy += 2200 * dt
          // steer toward the bin
          const cx = b.hx + b.x
          b.vx += ((b.tx - cx) * 9 - b.vx * 3.2) * dt
          const bottom = b.hy + b.y + b.h
          if (bottom > v.floor) {
            b.y = v.floor - b.h - b.hy
            if (b.vy > 0) b.vy *= -0.28
            b.vx *= 0.94
            b.va *= 0.8
          }
          b.va += (Math.random() - 0.5) * 10 * dt - b.a * 2 * dt
        } else {
          const k = 90
          const c = 2 * Math.sqrt(k) * 0.72
          b.vx += (-b.x * k - b.vx * c) * dt
          b.vy += (-b.y * k - b.vy * c) * dt
          b.va += (-b.a * k - b.va * c) * dt
        }
        const ccx = b.hx + b.x + b.w / 2
        const ccy = b.hy + b.y + b.h / 2
        const dx = ccx - lmx, dy = ccy - lmy
        const d2 = dx * dx + dy * dy
        if (d2 < 130 * 130) {
          const f = (1 - Math.sqrt(d2) / 130) * 2200
          const inv = 1 / Math.max(Math.sqrt(d2), 1)
          b.vx += (dx * inv * f + mvx * 16) * dt
          b.vy += (dy * inv * f + mvy * 16) * dt
          b.va += dx * inv * 3 * dt * 60
        }
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.a += b.va * dt
        const left = b.hx + b.x
        if (left < 0) ((b.x = -b.hx), (b.vx = Math.abs(b.vx) * 0.5))
        if (left + b.w > v.width) ((b.x = v.width - b.w - b.hx), (b.vx = -Math.abs(b.vx) * 0.5))
      }
      // words in the same bin stack instead of passing through each other
      if (!home) {
        for (let it = 0; it < 3; it++)
          for (let i = 0; i < v.bodies.length; i++)
            for (let j = i + 1; j < v.bodies.length; j++) {
              const A = v.bodies[i], B = v.bodies[j]
              const ax = A.hx + A.x, ay = A.hy + A.y, bx = B.hx + B.x, by = B.hy + B.y
              const ox = Math.min(ax + A.w, bx + B.w) - Math.max(ax, bx)
              const oy = Math.min(ay + A.h * 0.82, by + B.h * 0.82) - Math.max(ay + A.h * 0.14, by + B.h * 0.14)
              if (ox <= 0 || oy <= 0) continue
              if (oy < ox) {
                const up = ay < by ? A : B
                const dn = up === A ? B : A
                up.y -= oy
                if (up.vy > 0) up.vy = dn.vy * 0.5
              } else {
                const l = ax < bx ? A : B
                const r = l === A ? B : A
                l.x -= ox * 0.5
                r.x += ox * 0.5
              }
            }
      }
      for (const b of v.bodies) b.el.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0) rotate(${(b.a * 0.4).toFixed(2)}deg)`
    }
    mvx *= 0.8
    mvy *= 0.8
  }
}
