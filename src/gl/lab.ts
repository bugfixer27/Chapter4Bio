import * as THREE from 'three'
import { HASH, NOISE, SDF3, RAY } from './glsl'
import { U } from './uniforms'
import { FullScreen, sm } from './post'
import { TUBE, CUBES_C } from './cell'

/* ==========================================================================
   THE BENCH — two pieces of laboratory glass in the cell's own world.
   tubes  four centrifuge tubes, raymarched as thin glass over the points
          of the homogenate, each swinging out on its rotor arm as it spins
   cubes  Figure 4.6: one 5-unit cube cut into 125 unit cubes. The volume
          stays 125; every face the cut exposes lights up as new surface.
   ========================================================================== */

export class Tubes {
  fs: FullScreen
  constructor() {
    this.fs = new FullScreen(
      sm(
        /* glsl */ `
        ${HASH}${NOISE}${SDF3}${RAY}
        uniform sampler2D uBg;
        uniform vec4 uSwing, uTubeX, uFill, uShow;
        uniform float uSpin, uAmt;
        const float TR = ${(TUBE.R + 0.12).toFixed(2)}, TY0 = ${TUBE.y0.toFixed(2)}, TY1 = ${TUBE.y1.toFixed(2)};
        float pick(vec4 v, int i){ return i == 0 ? v.x : i == 1 ? v.y : i == 2 ? v.z : v.w; }
        vec3 toLocal(vec3 p, int i){
          vec3 piv = vec3(0.0, TY1 + 0.6, 0.0);
          vec3 q = p - vec3(pick(uTubeX, i), 0.0, 0.0) - piv;
          float a = -pick(uSwing, i) * 1.5707963;
          q.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * q.xy;
          return q + piv;
        }
        float sdTube(vec3 q){
          // a test tube: open cylinder, hemispherical bottom, a lip at the top
          vec3 c = q; c.y -= clamp(c.y, TY0, TY1 + 1.2);
          float d = abs(length(c) - TR) - 0.06;
          d = max(d, q.y - (TY1 + 1.2));
          d = min(d, sdTorus(q - vec3(0.0, TY1 + 1.2, 0.0), TR + 0.02, 0.1));
          return d;
        }
        float map(vec3 p, out int id){
          float d = 1e9; id = -1;
          for (int i = 0; i < 4; i++) {
            if (pick(uShow, i) < 0.01) continue;
            float di = sdTube(toLocal(p, i));
            if (di < d) { d = di; id = i; }
          }
          return d;
        }
        void main(){
          vec3 ro = uCamPos, rd = rayDir(vUv);
          vec4 bgS = texture(uBg, vUv);
          vec3 bg = bgS.rgb;
          // the rotor turning beneath: streaks rush past while a tube spins
          if (uSpin > 0.001) {
            vec2 sp = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
            float ang = atan(sp.y + 1.4, sp.x) * 40.0 + uTime * 30.0;
            float st = smoothstep(0.75, 1.0, sin(ang + gnoise(vec3(sp * 3.0, uTime))) );
            bg += vec3(0.4, 0.55, 0.8) * st * 0.05 * uSpin * smoothstep(1.4, 0.2, length(sp - vec2(0.0, -1.4)));
          }
          float t = 0.0;
          int id = -1;
          bool hit = false;
          for (int i = 0; i < 90; i++) {
            vec3 p = ro + rd * t;
            float d = map(p, id);
            if (d < 0.004) { hit = true; break; }
            t += max(d * 0.9, 0.01);
            if (t > 300.0) break;
          }
          vec3 col = bg;
          if (hit) {
            vec3 p = ro + rd * t;
            int j;
            vec2 e = vec2(0.004, 0.0);
            vec3 n = normalize(vec3(map(p + e.xyy, j) - map(p - e.xyy, j), map(p + e.yxy, j) - map(p - e.yxy, j), map(p + e.yyx, j) - map(p - e.yyx, j)));
            float cosi = abs(dot(rd, n));
            float F = 0.04 + 0.96 * pow(max(1.0 - cosi, 0.0), 5.0);
            // glass bends what is behind it, most at grazing angles
            vec2 off = n.xy * (1.0 - cosi) * 0.025;
            vec3 behind = texture(uBg, clamp(vUv - off, 0.001, 0.999)).rgb;
            col = behind * (0.92 - 0.1 * F) + env(reflect(rd, n)) * F * 0.9;
            col += vec3(0.7, 0.85, 1.0) * pow(max(1.0 - cosi, 0.0), 3.0) * 0.12;
            // the liquid inside, up to its meniscus
            vec3 q = toLocal(p, id);
            float lvl = pick(uFill, id);
            if (q.y < lvl) col += vec3(0.04, 0.07, 0.11) * smoothstep(lvl, lvl - 0.3, q.y) * 0.6;
            col += vec3(0.6, 0.8, 1.0) * exp(-((q.y - lvl) / 0.05) * ((q.y - lvl) / 0.05)) * 0.25 * step(q.y, TY1);
            col = mix(bg, col, pick(uShow, id));
          }
          o = vec4(mix(bg, col, uAmt), bgS.a);
        }`,
        {
          uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
          uRes: U.uRes, uTime: U.uTime, uBg: { value: null },
          uSwing: { value: new THREE.Vector4() }, uTubeX: { value: new THREE.Vector4(...TUBE.xs) },
          uFill: { value: new THREE.Vector4(5, -99, -99, -99) }, uShow: { value: new THREE.Vector4() },
          uSpin: { value: 0 }, uAmt: { value: 0 },
        },
      ),
    )
  }
}

/* ---------------------------------------------------------------- cubes */
export function buildCubes() {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const n = 125
  const grid = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    grid[i * 3] = i % 5
    grid[i * 3 + 1] = Math.floor(i / 5) % 5
    grid[i * 3 + 2] = Math.floor(i / 25)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.index = box.index
  g.setAttribute('position', box.attributes.position)
  g.setAttribute('normal', box.attributes.normal)
  g.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grid, 3))
  g.instanceCount = n
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    uniforms: { uSplit: { value: 0 }, uSeam: { value: 0 }, uAmt: { value: 0 }, uTime: U.uTime, uRot: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uSplit, uRot, uTime;
      in vec3 aGrid;
      out vec3 vL; out vec3 vN; out vec3 vG; out vec3 vV; out vec3 vNL;
      void main(){
        vec3 g = aGrid - 2.0;
        // each cube drifts out along its own direction as the block comes apart
        vec3 off = g * (1.0 + uSplit * 0.85);
        off += sin(vec3(dot(aGrid, vec3(1.3, 2.1, 0.7)), dot(aGrid, vec3(0.4, 1.7, 2.3)), dot(aGrid, vec3(2.2, 0.3, 1.1))) + uTime * 0.6) * 0.06 * uSplit;
        vec3 p = position + off;
        float c = cos(uRot), s = sin(uRot);
        mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
        mat3 T = mat3(1.0, 0.0, 0.0, 0.0, cos(0.42), sin(0.42), 0.0, -sin(0.42), cos(0.42));
        vec3 w = T * (R * p);
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        vL = position; vNL = normal; vG = aGrid;
        vN = normalize(mat3(modelViewMatrix) * (T * (R * normal)));
        vV = mv.xyz;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      layout(location=0) out vec4 o;
      uniform float uSplit, uSeam, uAmt;
      in vec3 vL; in vec3 vN; in vec3 vG; in vec3 vV; in vec3 vNL;
      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(-vV);
        // edges of this unit cube, and whether an edge is also an edge of the big block
        vec3 a = abs(vL);
        vec3 big = abs(vG - 2.0 + vL);
        float e1 = 0.0, e2 = 0.0;
        for (int k = 0; k < 3; k++) {
          int i1 = (k + 1) % 3, i2 = (k + 2) % 3;
          float on = smoothstep(0.035, 0.0, max(0.5 - a[i1], 0.5 - a[i2]));
          float outer = step(2.45, big[i1]) * step(2.45, big[i2]);
          e1 = max(e1, on * outer);
          e2 = max(e2, on);
        }
        // the faces the cut exposes: a neighbour used to sit on the other side
        vec3 nb = vG + vNL;
        float inner = step(-0.5, min(nb.x, min(nb.y, nb.z))) * step(max(nb.x, max(nb.y, nb.z)), 4.5);
        vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
        float dif = max(dot(n, L), 0.0) * 0.6 + 0.4;
        vec3 face = vec3(0.05, 0.16, 0.2) * dif;
        face = mix(face, vec3(1.0, 0.62, 0.2) * (0.25 + 0.45 * dif), inner * smoothstep(0.0, 0.6, uSplit));
        float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
        vec3 c = face + vec3(0.35, 0.85, 1.0) * rim * 0.25;
        c += vec3(0.55, 0.95, 1.0) * (e1 * 1.6 + e2 * uSeam * 1.1 * (1.0 - e1));
        o = vec4(c * uAmt, uAmt);
      }`,
  })
  const mesh = new THREE.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.position.copy(CUBES_C)
  mesh.renderOrder = 2
  return { mesh, mat }
}
