import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import { HASH, NOISE } from './glsl'
import { U } from './uniforms'

/* ==========================================================================
   MOLECULES — shared tools for the molecular sets.
   A protein is built from its secondary structure: α-helices are chains of
   spheres, globular domains are clusters. A marching-cubes pass melts the
   spheres into one smooth molecular surface, like a structure viewer's
   surface mode. One lit material serves every instanced molecule, with a
   colour per instance.
   ========================================================================== */

export type Ball = [number, number, number, number]
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export function blob(balls: Ball[], resMax = 56): THREE.BufferGeometry {
  const min = new THREE.Vector3(1e9, 1e9, 1e9)
  const max = new THREE.Vector3(-1e9, -1e9, -1e9)
  for (const [x, y, z, r] of balls) {
    min.min(new THREE.Vector3(x - r * 1.6, y - r * 1.6, z - r * 1.6))
    max.max(new THREE.Vector3(x + r * 1.6, y + r * 1.6, z + r * 1.6))
  }
  const c = min.clone().add(max).multiplyScalar(0.5)
  const ext = Math.max(max.x - min.x, max.y - min.y, max.z - min.z)
  const S = ext * 1.15
  const res = Math.round(Math.max(26, Math.min(resMax, ext / 0.12)))
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 160000)
  mc.isolation = 1
  mc.reset()
  for (const [x, y, z, r] of balls) mc.addBall(0.5 + (x - c.x) / S, 0.5 + (y - c.y) / S, 0.5 + (z - c.z) / S, 2 * (r / S) ** 2, 1)
  mc.update()
  const n = mc.count
  const pos = (mc as any).positionArray.slice(0, n * 3) as Float32Array
  const nor = (mc as any).normalArray.slice(0, n * 3) as Float32Array
  for (let i = 0; i < n; i++) {
    pos[i * 3] = c.x + (pos[i * 3] * S) / 2
    pos[i * 3 + 1] = c.y + (pos[i * 3 + 1] * S) / 2
    pos[i * 3 + 2] = c.z + (pos[i * 3 + 2] * S) / 2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  mc.geometry.dispose()
  return g
}

/** an α-helix from a to b: a chain of spheres winding round the axis */
export function helix(a: THREE.Vector3, b: THREE.Vector3, r = 0.5, k = 0.23): Ball[] {
  const out: Ball[] = []
  const L = a.distanceTo(b)
  const ax = b.clone().sub(a).normalize()
  const t = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0.3, 0.1, 1)).normalize()
  const s = new THREE.Vector3().crossVectors(ax, t)
  const n = Math.ceil(L / 0.15)
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const ang = i * 1.745
    const p = a.clone().lerp(b, f).addScaledVector(t, Math.cos(ang) * k).addScaledVector(s, Math.sin(ang) * k)
    out.push([p.x, p.y, p.z, r * 0.62])
  }
  return out
}
export function glob(c: THREE.Vector3, R: number, n: number, seed: number, flat = new THREE.Vector3(1, 1, 1)): Ball[] {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const out: Ball[] = []
  for (let i = 0; i < n; i++) {
    const d = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(R * Math.cbrt(rnd()) * 0.8).multiply(flat)
    out.push([c.x + d.x, c.y + d.y, c.z + d.z, R * (0.35 + rnd() * 0.25)])
  }
  return out
}
export function merge(list: THREE.BufferGeometry[]) {
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0)
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  let o = 0
  for (const g of list) {
    const gg = g.index ? g.toNonIndexed() : g
    pos.set(gg.attributes.position.array as Float32Array, o)
    nor.set(gg.attributes.normal.array as Float32Array, o)
    o += gg.attributes.position.count * 3
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

/** the lit molecular-surface look, for instanced or single meshes; colour per instance if given */
export function molMat(color = new THREE.Color(1, 1, 1), opts: { emissive?: number; grain?: number } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTime: U.uTime, uColor: { value: color }, uHi: { value: 0 }, uFade: { value: 1 }, uEmit: { value: opts.emissive ?? 0 }, uGrain: { value: opts.grain ?? 2.6 }, uFog: { value: 0.0016 } },
    vertexShader: /* glsl */ `
      out vec3 vN; out vec3 vV; out vec3 vWP; out vec3 vC;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(m) * normal);
        vV = mv.xyz;
        vC = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      ${HASH}${NOISE}
      uniform vec3 uColor; uniform float uHi, uFade, uEmit, uTime, uGrain, uFog;
      in vec3 vN; in vec3 vV; in vec3 vWP; in vec3 vC;
      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(-vV);
        if (!gl_FrontFacing) n = -n;
        vec3 L = normalize(vec3(-0.4, 0.8, 0.6));
        float dif = max(dot(n, L), 0.0);
        float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
        float rim = 1.0 - max(dot(n, v), 0.0);
        rim *= rim;
        float g = gnoise(vWP * uGrain) * 0.5 + 0.5;
        vec3 col = uColor * vC;
        vec3 c = col * (0.16 + 0.5 * wrap + 0.24 * dif) * (0.85 + 0.3 * g);
        c += col * rim * (1.25 + uHi * 2.0) + vec3(1.0) * rim * rim * 0.3;
        c += col * uEmit;
        c *= 1.0 + uHi * 0.8 * (0.6 + 0.4 * sin(uTime * 3.0));
        c *= exp(-max(0.0, length(vV) - 20.0) * uFog) * uFade;
        o = vec4(c, 1.0);
      }`,
  })
}

/* the ribosome: a large subunit (≈ 60S) cupped over a small one (≈ 40S), ≈ 25–30 nm, in units of 10 nm */
export function ribosomeParts() {
  const large = blob([...glob(V(0, 0.42, 0), 1.25, 22, 7, V(1, 0.75, 1)), ...glob(V(0.75, 0.6, 0.2), 0.55, 6, 9), ...glob(V(-0.7, 0.55, -0.2), 0.5, 6, 13)], 40)
  const small = blob([...glob(V(0, -0.62, 0), 0.95, 16, 21, V(1.15, 0.55, 0.85)), ...glob(V(-0.55, -0.45, 0.25), 0.4, 5, 27)], 40)
  return { large, small }
}
