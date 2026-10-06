/* Registers the inside sets with the engine. Each set renders itself into
   the engine's target: raster molecules first (colour + depth), then a
   raymarch that lays membranes over them. */
import * as THREE from 'three'
import type { Engine, WorldSet } from './engine'
import { film } from '../core/film'
import { Inside } from './inside'
import { InsideObjects } from './insideObjs'
import { insideStage, orgStage, fibStage, ecmStage, epiStage } from '../core/stages'
import { Organelles } from './org'
import { Cytoskeleton } from './fib'
import { Matrix } from './ecm'
import { Epithelium } from './epi'
import { vocab } from '../dom/lesson'
import { U } from './uniforms'
import { rt } from './post'

/** raymarched sets draw at a fraction of the screen's resolution; bloom and the grade hide the difference */
export const RM_SCALE = 0.72

class InSet implements WorldSet {
  rm = new Inside()
  obj = new InsideObjects()
  stage = insideStage(6, 0)
  out = rt()
  resize(w: number, h: number) {
    const W = Math.max(2, Math.round(w * RM_SCALE))
    const H = Math.max(2, Math.round(h * RM_SCALE))
    this.rm.setSize(W, H)
    this.out.setSize(W, H)
  }
  async warm(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera) {
    await r.compileAsync(this.obj.scene, cam).catch(() => {})
    await r.compileAsync(this.rm.fs.scene, this.rm.fs.cam).catch(() => {})
  }
  render(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, e: Engine) {
    const s = (this.stage = insideStage(film.F, U.uTime.value))
    this.obj.update(s.st, U.uTime.value)
    // 1 · the molecules, with depth
    r.setRenderTarget(this.rm.meshRT)
    r.setClearColor(0x000000, 0)
    r.clear(true, true, false)
    r.render(this.obj.scene, cam)
    // 2 · the membranes, raymarched over them
    const u = this.rm.fs.mat.uniforms
    e.setRayCam(u, cam)
    u.uMeshCol.value = this.rm.meshRT.texture
    u.uMeshDepth.value = this.rm.meshRT.depthTexture
    u.uNear.value = cam.near
    u.uFar.value = cam.far
    cam.getWorldDirection(u.uFwd.value)
    const k = s.u
    u.uSer.value = k.ser
    u.uGolgiPh.value = k.golgiPh
    u.uCutOn.value = k.cutOn
    u.uCutZ.value = k.cutZ
    u.uBud.value.copy(k.bud)
    u.uBudR.value = k.budR
    u.uBudK.value = k.budK
    u.uVes.value.copy(k.ves)
    u.uVesR.value = k.vesR
    u.uVesK.value = k.vesK
    u.uPhago.value = k.phago
    u.uLysoFuse.value = k.lysoFuse
    u.uDigest.value = k.digest
    u.uAuto.value = k.auto
    u.uAutoFuse.value = k.autoFuse
    u.uStore.value = k.store
    u.uExo.value = k.exo
    u.uCa.value = k.ca
    u.uLam.value = 1 - 0.85 * s.st.chromOn
    void target
    r.setRenderTarget(this.out)
    r.clear(true, true, false)
    this.rm.fs.render(r, this.out)
    return this.out
  }
}

/* a raymarch-only set, drawn at reduced resolution */
class RaySet implements WorldSet {
  out = rt()
  constructor(public fs: { fs: import('./post').FullScreen }, private sync: (u: Record<string, { value: any }>) => void) {}
  resize(w: number, h: number) {
    this.out.setSize(Math.max(2, Math.round(w * RM_SCALE)), Math.max(2, Math.round(h * RM_SCALE)))
  }
  async warm(r: THREE.WebGLRenderer) {
    await r.compileAsync(this.fs.fs.scene, this.fs.fs.cam).catch(() => {})
  }
  render(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, _t: THREE.WebGLRenderTarget, e: Engine) {
    const u = this.fs.fs.mat.uniforms
    e.setRayCam(u, cam)
    this.sync(u)
    r.setRenderTarget(this.out)
    r.clear(true, true, false)
    this.fs.fs.render(r, this.out)
    return this.out
  }
}

/* a raster set: a scene of molecules updated from the film */
class MeshSet implements WorldSet {
  constructor(private scene: THREE.Scene, private sync: () => void) {}
  async warm(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera) {
    this.sync()
    await r.compileAsync(this.scene, cam).catch(() => {})
  }
  render(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget) {
    this.sync()
    r.setRenderTarget(target)
    r.setClearColor(0x05070b, 1)
    r.clear(true, true, false)
    r.render(this.scene, cam)
    r.setClearColor(0x000000, 0)
    return target
  }
}

export function registerSets(engine: Engine) {
  const inside = new InSet()
  engine.register('in', inside)
  ;(engine as any).inside = inside

  const org = new Organelles()
  engine.register('org', new RaySet(org, (u) => {
    const s = orgStage(film.F)
    u.uEngulf.value = s.engulf
    u.uGen.value = s.gen
    u.uCrist.value = s.crist
    u.uEngulf2.value = s.engulf2
    u.uThyl.value = s.thyl
    u.uFis.value = s.fis
    u.uCutOn.value = s.cut
    // compartments light up as their names are read
    const k = vocab.active
    u.uComp.value = k === 'ims' || k === 'stroma' ? 1 : k === 'matrix' || k === 'thylakoid' || k === 'granum' ? 2 : 0
    u.uHiDNA.value = Math.max(s.hiDNA, k === 'mtdna' ? 1 : 0)
  }))

  const fib = new Cytoskeleton()
  engine.register('fib', new MeshSet(fib.scene, () => fib.update(fibStage(film.F), U.uTime.value)))
  ;(engine as any).fib = fib

  const ecm = new Matrix()
  engine.register('ecm', new MeshSet(ecm.scene, () => ecm.update(ecmStage(film.F), U.uTime.value)))

  const epi = new Epithelium()
  engine.register('epi', new RaySet(epi, (u) => {
    const s = epiStage(film.F)
    u.uDyeTop.value = s.dyeTop
    u.uDye.value = s.dye
    u.uHi.value = s.hi
  }))
}
