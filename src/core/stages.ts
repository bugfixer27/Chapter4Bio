/* The stage directions for the inside world (chapters 6–10): everything the
   nucleus → ER → Golgi → lysosome journey animates, as a pure function of
   film time F (so it reverses on scroll-up), plus the wall clock for the
   things that only ever idle (the Golgi's drift, ions jiggling). */
import * as THREE from 'three'
import { smooth, band, keyed } from './film'
import { onShell, DOCK } from '../gl/insideObjs'
import { GOLGI_C, EXO_P, LYSO, AUTO_M, PHAGO_P, RER_R } from '../gl/inside'
import type { InsideStage } from '../gl/insideObjs'
import type { FibStage } from '../gl/fib'
import type { EcmStage } from '../gl/ecm'

export type InsideUniforms = {
  ser: number
  golgiPh: number
  cutOn: number
  cutZ: number
  bud: THREE.Vector3
  budR: number
  budK: number
  ves: THREE.Vector3
  vesR: number
  vesK: number
  phago: number
  lysoFuse: number
  digest: number
  auto: number
  autoFuse: number
  store: number
  exo: number
  ca: number
}

/* the transitional ER exit site, on the outermost sheet, facing the Golgi */
export const TER = onShell(-42, 6, RER_R[2] + 2.2 + 0.35)
const TER_OUT = TER.clone().add(new THREE.Vector3(3.2, 0, 0))
const CIS = new THREE.Vector3(GOLGI_C.x - 15 - 4.2, GOLGI_C.y + 2, 0)
const TRANS = new THREE.Vector3(GOLGI_C.x + 18, GOLGI_C.y + 8, 4)

export function insideStage(F: number, time: number): { st: InsideStage; u: InsideUniforms } {
  const st: InsideStage = {
    chromOn: band(6.36, 6.4, 6.8, 6.84, F),
    chromC: keyed([[6.58, 0], [6.63, 1], [6.68, 2], [6.74, 3]], F),
    ribOn: 1,
    hero: band(6.94, 6.98, 7.92, 7.96, F),
    assemble: smooth(6.98, 7.12, F),
    transl: F < 7.34 ? smooth(7.06, 7.28, F) : smooth(7.43, 7.6, F),
    dock: smooth(7.37, 7.45, F),
    glyco: smooth(7.6, 7.72, F),
    export: band(6.74, 6.78, 7.02, 7.06, F),
    caOn: band(8.53, 8.56, 8.7, 8.73, F),
    caIn: smooth(8.56, 8.62, F),
    caOut: smooth(8.63, 8.665, F),
    ser: 1 + 1.6 * smooth(8.76, 8.88, F),
    lysoOn: smooth(9.55, 9.6, F) * (1 - smooth(10.66, 10.7, F)),
    store: smooth(10.53, 10.6, F),
    ly1: new THREE.Vector3(),
    ly2: new THREE.Vector3(),
  }
  // during the free-ribosome beat the first chain folds and is released before the second begins
  if (F > 7.28 && F < 7.43) st.transl = 1 - smooth(7.32, 7.36, F)
  const phago = smooth(10.16, 10.28, F)
  const lysoFuse = smooth(10.25, 10.31, F)
  const auto = smooth(10.33, 10.42, F)
  const autoFuse = smooth(10.41, 10.47, F)
  const bc = PHAGO_P.clone().add(new THREE.Vector3(18 - 34 * smooth(0.55, 1, phago) - 40 * lysoFuse, 0, 0))
  st.ly1.copy(LYSO[1]).lerp(bc.clone().add(new THREE.Vector3(-6, -12, 4)), lysoFuse)
  st.ly2.copy(LYSO[2]).lerp(AUTO_M.clone().add(new THREE.Vector3(-18, -10, 10)), autoFuse)

  /* the hero vesicle: buds from transitional ER, drifts, fuses with the cis face; later one leaves the trans face for the membrane */
  const u: InsideUniforms = {
    ser: st.ser,
    golgiPh: time * 0.012 + 7 * smooth(9.32, 9.54, F),
    cutOn: 0,
    cutZ: 0.2,
    bud: TER.clone(),
    budR: 0,
    budK: 0,
    ves: new THREE.Vector3(),
    vesR: 0,
    vesK: 0,
    phago,
    lysoFuse,
    digest: smooth(10.29, 10.35, F),
    auto,
    autoFuse,
    store: st.store,
    exo: smooth(9.79, 9.88, F),
    ca: band(8.63, 8.645, 8.67, 8.7, F),
  }
  const grow = smooth(8.32, 8.37, F)
  if (F < 8.41 && grow > 0) {
    u.bud.lerpVectors(TER, TER_OUT, grow)
    u.budR = 3.0 * grow
    u.budK = 2.6 * (1 - smooth(8.37, 8.41, F))
  } else if (F >= 8.41 && F < 9.18) {
    // free: waits beside the exit site, then (ch. 9) carries its cargo to the cis face and fuses
    const go = smooth(9.02, 9.13, F)
    u.ves.lerpVectors(TER_OUT.clone().add(new THREE.Vector3(1.5, 1, 0)), CIS, go)
    u.ves.y += Math.sin(go * Math.PI) * 6
    u.vesR = 3.0 * (1 - smooth(9.13, 9.17, F))
    u.vesK = 2.0 * smooth(9.12, 9.15, F)
  } else if (F >= 9.62 && F < 9.82) {
    const go = smooth(9.66, 9.79, F)
    const end = EXO_P.clone().add(new THREE.Vector3(-10, 0, 0))
    u.ves.lerpVectors(TRANS, end, go)
    u.ves.y += Math.sin(go * Math.PI) * 10
    u.vesR = 3.4 * smooth(9.62, 9.65, F) * (1 - smooth(9.785, 9.8, F))
  }
  // sections cut through the world where its insides matter
  const cut = Math.max(band(7.4, 7.44, 7.86, 7.9, F), band(8.0, 8.03, 8.28, 8.31, F), band(9.32, 9.35, 9.53, 9.56, F), band(10.17, 10.2, 10.31, 10.33, F))
  u.cutOn = cut > 0.5 ? 1 : 0
  void GOLGI_C
  void DOCK
  return { st, u }
}

/* ------------------------------------------------------------ organelles (ch. 11–12) */
export function orgStage(F: number) {
  return {
    engulf: smooth(11.2, 11.32, F),
    gen: keyed([[11.3, 0], [11.36, 1], [11.4, 2], [11.7, 2], [11.78, 3]], F),
    crist: smooth(11.34, 11.42, F),
    engulf2: smooth(11.4, 11.5, F),
    thyl: smooth(11.48, 11.54, F),
    fis: band(12.34, 12.37, 12.39, 12.42, F),
    hiDNA: band(11.63, 11.66, 11.72, 11.75, F) + band(12.2, 12.22, 12.26, 12.28, F),
    cut: 1,
  }
}

/* ------------------------------------------------------------ cytoskeleton (ch. 13–14) */
export function fibStage(F: number): FibStage {
  const grow = smooth(13.3, 13.35, F)
  const cat = smooth(13.36, 13.42, F)
  return {
    len0: 34 + 22 * grow - 26 * cat,
    peel: cat > 0.001 && cat < 0.999 ? 14 : cat >= 0.999 ? 10 : 0,
    cap: 1 - cat,
    fade: 1,
    hiPf: band(13.19, 13.21, 13.27, 13.29, F) > 0.5 ? 0 : -1,
    slide: 30 * smooth(13.58, 13.7, F),
    myo: band(13.55, 13.58, 13.7, 13.73, F),
    walk: smooth(13.43, 13.56, F),
    kin: band(13.4, 13.43, 13.56, 13.59, F),
    cen: band(13.8, 13.84, 14.0, 14.02, F),
    ax: band(14.15, 14.18, 14.86, 14.9, F),
    dyn: 1 - band(14.8, 14.83, 14.9, 14.93, F),
    links: F > 14.5 && F < 14.59 ? 0 : 1,
    slideOn: band(14.47, 14.5, 14.68, 14.71, F),
    slideAmt: smooth(14.5, 14.58, F),
    bend: band(14.6, 14.66, 14.7, 14.72, F) * 0.9,
    cil: band(14.0, 14.04, 14.16, 14.19, F) + band(14.7, 14.73, 14.92, 14.95, F),
    beat: 1 - smooth(14.82, 14.86, F),
  }
}

/* ------------------------------------------------------------ the wall and the matrix (ch. 15–16) */
export function ecmStage(F: number): EcmStage {
  return {
    wall: 1 - band(15.33, 15.36, 15.98, 16.0, F),
    primary: smooth(15.02, 15.12, F) + (F > 16 ? 1 : 0),
    lamella: smooth(15.17, 15.22, F) + (F > 16 ? 1 : 0),
    sec: smooth(15.22, 15.32, F) * (1 - smooth(15.98, 16.0, F)) + (F > 16 ? 0.4 : 0),
    pd: smooth(15.99, 16.03, F),
    ecm: band(15.33, 15.37, 15.95, 15.98, F),
    signal: smooth(15.72, 15.88, F),
  }
}

/* ------------------------------------------------------------ the epithelium (ch. 16) */
export function epiStage(F: number) {
  return {
    dyeTop: smooth(16.36, 16.44, F) * (1 - smooth(16.47, 16.5, F)),
    dye: smooth(16.66, 16.84, F),
    hi: F > 16.34 && F < 16.48 ? 1 : F > 16.48 && F < 16.6 ? 2 : F > 16.65 && F < 16.88 ? 3 : 0,
  }
}
