import * as THREE from 'three'
import { film, updateFilm, camAt, type SetName, UNIT_M, smooth } from '../core/film'
import { scroll } from '../core/scroll'
import { U } from './uniforms'
import { buildCell, BACT_HOME, MASK } from './cell'
import { Tubes, buildCubes } from './lab'
import { Scale, viewAt, blendView, PAIR_FOCUS, type View } from './scale'
import { Bloom, finalPass, portalPass, scopePass, rt } from './post'
import { Plates, SHOTS } from './plates'
import { TUBE } from './cell'

/* ==========================================================================
   THE RENDER GRAPH (one frame)
     outer set → A        scale: the procedural world (hero lens, ladder)
                          cell:  points (+ cubes) → tubes glass → microscope
                          in, org, fib, ecm, epi: their own passes
     inner set → M        only while a transition is running
     portal    A, M → C   lens or dissolve
     plates               DOM-mirrored stills
     bloom + grade        → screen (engraving when the page turns to paper)
   ========================================================================== */

export interface WorldSet {
  resize?(w: number, h: number): void
  render(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, e: Engine): THREE.WebGLRenderTarget
  warm?(r: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera): Promise<void>
}

export class Engine {
  renderer: THREE.WebGLRenderer
  camA = new THREE.PerspectiveCamera(34, 1, 0.1, 4000)
  camB = new THREE.PerspectiveCamera(34, 1, 0.1, 4000)
  w = 1
  h = 1
  dpr = 1
  A = rt(2, 2, true, 4)
  B = rt(2, 2, true)
  M = rt(2, 2, true, 4)
  M2 = rt(2, 2, true)
  C = rt()
  S1 = rt(2, 2, true)
  S2 = rt(2, 2, true)
  T1 = rt()
  bloom = new Bloom(6)
  finalP = finalPass()
  portal = portalPass()
  scope = scopePass()
  plates = new Plates()

  scale = new Scale()
  cellScene = new THREE.Scene()
  cell = buildCell()
  cubes = buildCubes()
  tubes = new Tubes()
  sets: Partial<Record<SetName, WorldSet>> = {}

  spot = { x: 0, y: 0, r: 300, amt: 0 }
  private spotE = { x: 0, y: 0, r: 300, amt: 0 }
  /** the structure being taught, lit in the cell (set from the key terms) */
  hiMask = 0
  hiAmt = 0
  private hiE = 0

  mouse = new THREE.Vector2()
  mouseT = new THREE.Vector2()
  mouseActive = 0
  mouseVel = new THREE.Vector2()
  parallax = new THREE.Vector2()
  lensMouse = new THREE.Vector2(0.62, 0.47)
  raycaster = new THREE.Raycaster()
  time = 0
  maxPr = 1.25
  private lastNow = performance.now()
  private acc = 0
  private nF = 0
  view: View = { cx: 0, cy: 0, H: 1, Z: 0 }

  constructor(canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true })
    r.autoClear = false
    r.outputColorSpace = THREE.LinearSRGBColorSpace
    r.toneMapping = THREE.NoToneMapping
    this.renderer = r
    this.cellScene.add(this.cell.points, this.cubes.mesh)
    addEventListener('pointermove', (e) => {
      const nx = (e.clientX / innerWidth) * 2 - 1
      const ny = -(e.clientY / innerHeight) * 2 + 1
      this.mouseVel.set(nx - this.mouseT.x, ny - this.mouseT.y)
      this.mouseT.set(nx, ny)
      this.mouseActive = 1
    })
    document.addEventListener('pointerleave', () => (this.mouseActive = 0))
    this.resize()
    addEventListener('resize', () => this.resize())
  }

  register(name: SetName, s: WorldSet) {
    this.sets[name] = s
    s.resize?.(Math.round(this.w * this.dpr), Math.round(this.h * this.dpr))
  }

  resize() {
    this.w = innerWidth
    this.h = innerHeight
    const pr = Math.min(devicePixelRatio || 1, this.maxPr)
    this.dpr = pr
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(this.w, this.h, false)
    const W = Math.round(this.w * pr)
    const H = Math.round(this.h * pr)
    for (const t of [this.A, this.B, this.C, this.M, this.M2, this.S1, this.S2, this.T1]) t.setSize(W, H)
    this.bloom.setSize(W, H)
    this.scale.resize(W, H)
    for (const st of Object.values(this.sets)) st?.resize?.(W, H)
    U.uRes.value.set(W, H)
    for (const c of [this.camA, this.camB]) {
      c.aspect = this.w / this.h
      c.updateProjectionMatrix()
    }
    this.plates.measure(scroll.y)
  }

  async warmup() {
    const r = this.renderer
    const fs = [...this.scale.all(), this.tubes.fs, this.portal, this.finalP, this.scope, this.bloom.bright, this.bloom.down, this.bloom.upP]
    await Promise.all([
      r.compileAsync(this.cellScene, this.camA).catch(() => {}),
      r.compileAsync(this.plates.scene, this.plates.cam).catch(() => {}),
      ...fs.map((f) => r.compileAsync(f.scene, f.cam).catch(() => {})),
    ])
    for (const s of Object.values(this.sets)) await s?.warm?.(r, this.camA)
    const F0 = film.F
    for (const F of [0.3, 1.5, 2.5, 3.3, 4.6, 5.5, 7.5, 9.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.3]) {
      updateFilm(F)
      this.placeCam(this.camA, film.outer, F)
      this.renderSet(film.outer, this.camA, this.A)
    }
    updateFilm(F0)
    for (const key of Object.keys(SHOTS)) {
      if (!this.plates.captures.has(key)) this.capture(key)
      await new Promise((res) => requestAnimationFrame(res))
    }
  }

  /* ---- place a camera on a set's path at film time F ---- */
  private _t = new THREE.Vector3()
  placeCam(cam: THREE.PerspectiveCamera, set: SetName, F: number, parallax = 1) {
    cam.fov = camAt(set, F, cam.position, this._t)
    cam.up.set(0, 1, 0)
    cam.lookAt(this._t)
    if (parallax > 0 && set !== 'scale') {
      const d = cam.position.distanceTo(this._t)
      const k = d * 0.02 * (1 - film.paper * 0.8) * parallax * (film.mode > 0.5 || film.modeB > 0.5 ? 0.15 : 1)
      cam.updateMatrixWorld()
      cam.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), this.parallax.x * k)
      cam.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), this.parallax.y * k * 0.6)
      cam.lookAt(this._t)
    }
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    return this._t.clone()
  }

  /* ---- per-frame uniforms of the cell ---- */
  syncCell(cam: THREE.PerspectiveCamera, tgt: THREE.Vector3) {
    const f = film
    const u = this.cell.mat.uniforms
    u.uOrg.value = f.organelles
    u.uCyto.value = f.cyto
    u.uVes.value = f.vesicles
    u.uMem.value = f.memGlow
    u.uFocus.value = cam.position.distanceTo(tgt)
    u.uPx.value = this.dpr * (this.h / 900)
    u.uMap.value = f.dmap
    u.uMapHi.value = f.mapHi
    u.uPlant.value = f.plant
    u.uBact.value = f.bact
    u.uVilli.value = f.villi
    u.uFlag.value = f.flag
    u.uFlat.value = f.flat
    u.uHomog.value = f.homog
    u.uFrac.value = f.frac
    ;(u.uSwing.value as THREE.Vector4).set(f.swing[0], f.swing[1], f.swing[2], f.swing[3])
    u.uMacro.value = f.macro
    u.uEngulf.value = f.engulf
    u.uDigest.value = f.digest
    u.uLive.value = f.live
    u.uHiMask.value = this.hiMask
    u.uHiAmt.value = this.hiE
    // the bacterium: beside the cell, then hunted by the macrophage
    const bp = u.uBactPos.value as THREE.Vector3
    if (f.macro > 0.001) {
      const pull = smooth(0.3, 0.75, f.engulf)
      bp.set(16.5, -0.8, 3.2).lerp(new THREE.Vector3(7.4, -0.6, 2.4), pull)
      u.uBactRot.value = 0.6 + this.time * 0.15 * (1 - pull)
    } else {
      bp.copy(BACT_HOME)
      u.uBactRot.value = 0.35
    }
    ;(u.uView.value as THREE.Vector3).copy(cam.position).sub(tgt).normalize()
    ;(u.uFocusP.value as THREE.Vector3).set(-1, 0, 0)
    const c = this.cubes.mat.uniforms
    c.uAmt.value = f.cubes
    c.uSplit.value = f.split
    c.uSeam.value = f.seam
    c.uRot.value = 0.6 + f.F * 1.2
    this.cubes.mesh.visible = f.cubes > 0.001
  }

  /* ---- render one set into a target; returns the target holding the image ---- */
  renderSet(set: SetName, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, look?: THREE.Vector3): THREE.WebGLRenderTarget {
    const r = this.renderer
    const f = film
    if (set === 'scale') {
      const v = viewAt(f.zoom, this.view)
      blendView(v, PAIR_FOCUS.x, PAIR_FOCUS.y, PAIR_FOCUS.H, f.pair)
      this.scale.update(v, this.w / this.h, this.w, this.h)
      const L = this.scale.lens
      const cx = 0.5 + (0.07 * this.h) / this.w
      L.set(this.lensMouse.x + (cx - this.lensMouse.x) * f.lensToCentre, this.lensMouse.y + (0.5 - this.lensMouse.y) * f.lensToCentre, f.lensR, f.lensMag)
      r.setRenderTarget(target)
      r.setClearColor(0x000000, 0)
      r.clear(true, true, false)
      this.scale.render(r, target, f.hero, f.lensWorld, f.headAmt)
      return target
    }
    if (set === 'cell') {
      this.syncCell(cam, look ?? new THREE.Vector3())
      const u = this.cell.mat.uniforms
      const drawCell = (mode: number, into: THREE.WebGLRenderTarget) => {
        u.uMode.value = mode
        r.setRenderTarget(into)
        r.setClearColor(0x000000, 0)
        r.clear(true, true, false)
        r.render(this.cellScene, cam)
      }
      // the microscopes: one or two renders through the scope
      if (f.mode > 0.5 || f.modeB > 0.5 || f.wipeAmt > 0.001) {
        drawCell(f.mode, this.S1)
        if (f.wipeAmt > 0.001 || f.modeB !== f.mode) drawCell(f.modeB, this.S2)
        const s = this.scope.mat.uniforms
        s.uA.value = this.S1.texture
        s.uB.value = this.S2.texture
        s.uModeA.value = f.mode
        s.uModeB.value = f.modeB
        s.uWipe.value = f.wipe
        s.uWipeAmt.value = f.modeB !== f.mode ? 1 : 0
        if (f.modeB === f.mode) s.uB.value = this.S1.texture
        this.scope.render(r, target)
        u.uMode.value = 0
        return target
      }
      drawCell(0, target)
      // the centrifuge tubes, glass over the homogenate
      const show = f.tubeShow
      if (show[0] + show[1] + show[2] + show[3] > 0.001) {
        const g = this.tubes.fs.mat.uniforms
        this.setRayCam(g, cam)
        g.uBg.value = target.texture
        ;(g.uSwing.value as THREE.Vector4).set(f.swing[0], f.swing[1], f.swing[2], f.swing[3])
        ;(g.uShow.value as THREE.Vector4).set(show[0], show[1], show[2], show[3])
        g.uSpin.value = f.spin
        g.uAmt.value = 1
        const s = f.frac
        const lv = (j: number) => {
          if (s < j - 0.2) return -99
          if (s < j + 0.85 || j === 3) return TUBE.y0 + (TUBE.y1 - 1.2 - TUBE.y0) * (1 - Math.min(s, 4) * 0.12) - (s > j + 0.75 && j < 3 ? 99 : 0)
          return -99
        }
        ;(g.uFill.value as THREE.Vector4).set(lv(0), lv(1), lv(2), lv(3))
        const out = target === this.A ? this.B : this.M2
        this.tubes.fs.render(r, out)
        return out
      }
      return target
    }
    const s = this.sets[set]
    if (s) return s.render(r, cam, target, this)
    r.setRenderTarget(target)
    r.setClearColor(0x000000, 0)
    r.clear(true, true, false)
    return target
  }

  private _inv = new THREE.Matrix4()
  private _vp = new THREE.Matrix4()
  setRayCam(u: Record<string, { value: any }>, cam: THREE.PerspectiveCamera) {
    this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    this._inv.copy(this._vp).invert()
    u.uInvVP.value.copy(this._inv)
    u.uCamPos.value.copy(cam.position)
    if (u.uVP) u.uVP.value.copy(this._vp)
  }

  /* one still of a set at another moment, for a plate */
  private capture(key: string) {
    const shot = SHOTS[key]
    const W = 1200
    const H = 800
    const out = rt(W, H, true)
    const F0 = film.F
    updateFilm(shot.F)
    const cam = new THREE.PerspectiveCamera(shot.fov, W / H, 0.1, 4000)
    cam.position.set(...shot.pos)
    cam.lookAt(...shot.look)
    cam.updateMatrixWorld()
    const prevRes = U.uRes.value.clone()
    U.uRes.value.set(W, H)
    const tmp = rt(W, H, true)
    const res = this.renderSet(shot.set, cam, tmp, new THREE.Vector3(...shot.look))
    const r = this.renderer
    r.setRenderTarget(out)
    r.clear(true, true, false)
    this.portal.mat.uniforms.uMacro.value = res.texture
    this.portal.mat.uniforms.uMicro.value = res.texture
    this.portal.mat.uniforms.uR.value = 0
    this.portal.mat.uniforms.uStyle.value = 0
    this.portal.render(r, out)
    U.uRes.value.copy(prevRes)
    tmp.dispose()
    updateFilm(F0)
    this.plates.captures.set(key, out)
  }

  /* ---- screen-space projection for the DOM labels ---- */
  private _p = new THREE.Vector3()
  project(set: SetName, v: THREE.Vector3): [number, number, boolean] {
    if (film.outer !== set || film.portal > 0.02) return [0, 0, false]
    this._p.copy(v).project(this.camA)
    return [(this._p.x * 0.5 + 0.5) * this.w, (-this._p.y * 0.5 + 0.5) * this.h, this._p.z < 1]
  }
  scaleText() {
    const fmt = (m: number) => {
      const f = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toPrecision(2))
      if (m < 1e-9) return `${f(m * 1e12)} pm`
      if (m < 1e-6) return `${f(m * 1e9)} nm`
      if (m < 1e-3) return `${f(m * 1e6)} µm`
      if (m < 1) return `${f(m * 1e3)} mm`
      return `${f(m)} m`
    }
    if (film.outer === 'scale') return fmt(this.view.H)
    const cam = this.camA
    const d = cam.position.distanceTo(this._look)
    const hWorld = 2 * d * Math.tan(((cam.fov * Math.PI) / 180) / 2)
    return fmt(hWorld * UNIT_M[film.outer] * film.unitMul)
  }
  private _look = new THREE.Vector3()

  frame(dt: number) {
    dt = Math.min(dt, 0.1)
    this.time += dt
    U.uTime.value = this.time
    U.uScrollVel.value = scroll.velN
    const f = updateFilm(scroll.F)
    U.uPaper.value = f.paper
    U.uFlash.value = 0

    const want = this.plates.wanted(scroll.y, scroll.vh)
    if (want.length) this.capture(want[0])

    /* cameras */
    this.mouse.lerp(this.mouseT, Math.min(1, dt * 6))
    this.parallax.lerp(this.mouseT, Math.min(1, dt * 2.2))
    this.mouseVel.multiplyScalar(Math.exp(-dt * 8))
    // the hero lens drifts toward the cursor
    const lx = 0.5 + this.mouse.x * 0.5
    const ly = 0.5 + this.mouse.y * 0.5
    const tl = this.mouseActive ? new THREE.Vector2(0.5 + (lx - 0.5) * 0.85, 0.5 + (ly - 0.5) * 0.85) : new THREE.Vector2(0.62, 0.47)
    this.lensMouse.lerp(tl, Math.min(1, dt * 2.4))
    const look = this.placeCam(this.camA, f.outer, f.F)
    this._look.copy(look)
    let lookB: THREE.Vector3 | null = null
    if (f.inner) lookB = this.placeCam(this.camB, f.inner, f.F)

    this.raycaster.setFromCamera(this.mouse, this.camA)
    U.uRayO.value.copy(this.raycaster.ray.origin)
    U.uRayD.value.copy(this.raycaster.ray.direction)
    const moving = Math.min(1, this.mouseVel.length() * 30)
    U.uMouseF.value = this.mouseActive * (0.3 + 0.7 * moving)
    this.hiE += (this.hiAmt - this.hiE) * Math.min(1, dt * 4)

    const r = this.renderer
    let cur = this.renderSet(f.outer, this.camA, this.A, look)
    if (f.inner && f.portal > 0.001 && lookB) {
      const inner = this.renderSet(f.inner, this.camB, this.M, lookB)
      // the outer set's image may have been written to a target the inner render reused: re-render if so
      if (cur === inner) cur = this.renderSet(f.outer, this.camA, this.A, look)
      const pu = this.portal.mat.uniforms
      pu.uMacro.value = cur.texture
      pu.uMicro.value = inner.texture
      pu.uR.value = f.portal
      pu.uStyle.value = f.pStyle === 'fade' ? 1 : 0
      ;(pu.uC.value as THREE.Vector2).set(f.pC[0], f.pC[1])
      this.portal.render(r, this.C)
      cur = this.C
    }

    /* plates */
    if (this.plates.update(scroll.y, this.w, this.h, scroll.velN, dt)) {
      r.setRenderTarget(cur)
      r.render(this.plates.scene, this.plates.cam)
    }

    /* bloom + grade */
    const scopeOn = f.outer === 'cell' && (f.mode > 0.5 || f.modeB > 0.5) && f.mode !== 5 && f.modeB !== 5
    const bloomTex = this.bloom.render(r, cur.texture, f.outer === 'cell' ? 0.55 : 0.8)
    const fu = this.finalP.mat.uniforms
    fu.uMap.value = cur.texture
    fu.uBloom.value = bloomTex
    fu.uExposure.value = f.exposure
    fu.uBloomAmt.value = scopeOn ? 0.0 : f.outer === 'cell' ? 0.55 : 0.4
    fu.uVignette.value = f.vignette
    fu.uGrain.value = 0.03
    fu.uLinear.value += ((scopeOn ? 1 : 0) - fu.uLinear.value) * Math.min(1, dt * 8)
    const e = this.spotE
    const k = Math.min(1, dt * 5)
    e.x += (this.spot.x - e.x) * k
    e.y += (this.spot.y - e.y) * k
    e.r += (this.spot.r - e.r) * k
    e.amt += (this.spot.amt - e.amt) * Math.min(1, dt * 3)
    fu.uSpot.value.set(e.x / this.w, 1 - e.y / this.h, e.r / this.h)
    fu.uSpotAmt.value = e.amt * (1 - f.paper) * (scopeOn ? 0 : 1)
    this.finalP.render(r, null)

    /* keep the frame budget: measure real frame times (only while visible) and step the resolution */
    const now = performance.now()
    const real = now - this.lastNow
    this.lastNow = now
    if (document.visibilityState === 'visible' && real < 400) {
      this.acc += real
      if (++this.nF >= 45) {
        const avg = this.acc / this.nF
        this.acc = 0
        this.nF = 0
        if (avg > 21 && this.maxPr > 0.75) {
          this.maxPr = Math.max(0.75, this.maxPr - 0.15)
          this.resize()
        } else if (avg < 11 && this.maxPr < Math.min(1.5, devicePixelRatio || 1)) {
          this.maxPr = Math.min(1.5, this.maxPr + 0.1)
          this.resize()
        }
      }
    }
  }
}
export { MASK }
