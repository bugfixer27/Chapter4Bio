/* Fill every data-v hook in the copy from the model, so the prose can't drift. */
import * as S from './cell'

const fmt = (n: number, d = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/,/g, ' ')

export function fillNumbers() {
  const v: Record<string, string> = {
    big: fmt(S.BIG.surface),
    small: fmt(S.SMALL.surface),
    vol: fmt(S.BIG.volume),
    ratioBig: fmt(S.BIG.surface / S.BIG.volume, 1),
    ratioSmall: fmt(S.SMALL.surface / S.SMALL.volume, 0),
    collagen: fmt(S.COLLAGEN_PCT),
    chromosomes: fmt(S.NUCLEUS.chromosomes),
  }
  document.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => {
    const k = el.dataset.v!
    if (k in v) el.textContent = v[k]
  })
}
