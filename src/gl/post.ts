import * as THREE from 'three'
import { HASH, NOISE, TONE } from './glsl'
import { U } from './uniforms'

const VERT = /* glsl */ `
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export class FullScreen {
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  constructor(public mat: THREE.ShaderMaterial) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    q.frustumCulled = false
    this.scene.add(q)
  }
  render(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget | null) {
    r.setRenderTarget(out)
    r.render(this.scene, this.cam)
  }
}

export const sm = (frag: string, uniforms: Record<string, { value: any }>, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader: VERT,
    fragmentShader: `precision highp float;\nlayout(location=0) out vec4 o;\nin vec2 vUv;\n${frag}`,
    ...extra,
  })

/** a full-screen raymarch that also writes depth, so raster meshes can be drawn into the same frame afterwards */
export const smDepth = (frag: string, uniforms: Record<string, { value: any }>) =>
  sm(frag, uniforms, { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth })

export const rt = (w = 2, h = 2, depth = false, samples = 0) =>
  new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: depth,
    samples,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  })

/* ------------------------------------------------------------------ bloom
   Dual-filter (Kawase) bloom: a soft-knee bright pass, five halvings down
   and back up. Cheap, wide, and free of the boxy look of a single blur. */
export class Bloom {
  levels: THREE.WebGLRenderTarget[] = []
  up: THREE.WebGLRenderTarget[] = []
  bright: FullScreen
  down: FullScreen
  upP: FullScreen
  constructor(n = 6) {
    for (let i = 0; i < n; i++) {
      this.levels.push(rt())
      this.up.push(rt())
    }
    this.bright = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap; uniform float uThresh;
        void main(){
          vec3 c = texture(uMap, vUv).rgb;
          c = clamp(c, vec3(0.0), vec3(1e4));
          float l = max(c.r, max(c.g, c.b));
          float k = uThresh * 0.5;
          float soft = clamp(l - uThresh + k, 0.0, 2.0*k); soft = soft*soft/(4.0*k + 1e-4);
          float w = max(soft, l - uThresh) / max(l, 1e-4);
          o = vec4(min(c * w, vec3(60.0)), 1.0);
        }`,
        { uMap: { value: null }, uThresh: { value: 1.0 } },
      ),
    )
    this.down = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap; uniform vec2 uTexel;
        void main(){
          vec2 h = uTexel * 0.5;
          vec3 s = texture(uMap, vUv).rgb * 4.0;
          s += texture(uMap, vUv - h).rgb; s += texture(uMap, vUv + h).rgb;
          s += texture(uMap, vUv + vec2(h.x, -h.y)).rgb; s += texture(uMap, vUv - vec2(h.x, -h.y)).rgb;
          o = vec4(s / 8.0, 1.0);
        }`,
        { uMap: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ),
    )
    this.upP = new FullScreen(
      sm(
        /* glsl */ `
        uniform sampler2D uMap, uBase; uniform vec2 uTexel;
        void main(){
          vec2 h = uTexel * 0.5;
          vec3 s = texture(uMap, vUv + vec2(-h.x*2.0, 0.0)).rgb;
          s += texture(uMap, vUv + vec2(-h.x, h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(0.0, h.y*2.0)).rgb;
          s += texture(uMap, vUv + vec2(h.x, h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(h.x*2.0, 0.0)).rgb;
          s += texture(uMap, vUv + vec2(h.x, -h.y)).rgb * 2.0;
          s += texture(uMap, vUv + vec2(0.0, -h.y*2.0)).rgb;
          s += texture(uMap, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
          o = vec4(s / 12.0 * 0.72 + texture(uBase, vUv).rgb, 1.0);
        }`,
        { uMap: { value: null }, uBase: { value: null }, uTexel: { value: new THREE.Vector2() } },
      ),
    )
  }
  setSize(w: number, h: number) {
    let W = Math.max(2, w >> 1)
    let H = Math.max(2, h >> 1)
    for (let i = 0; i < this.levels.length; i++) {
      this.levels[i].setSize(W, H)
      this.up[i].setSize(W, H)
      W = Math.max(2, W >> 1)
      H = Math.max(2, H >> 1)
    }
  }
  render(r: THREE.WebGLRenderer, src: THREE.Texture, thresh: number) {
    const b = this.bright.mat.uniforms
    b.uMap.value = src
    b.uThresh.value = thresh
    this.bright.render(r, this.levels[0])
    const d = this.down.mat.uniforms
    for (let i = 1; i < this.levels.length; i++) {
      d.uMap.value = this.levels[i - 1].texture
      d.uTexel.value.set(1 / this.levels[i - 1].width, 1 / this.levels[i - 1].height)
      this.down.render(r, this.levels[i])
    }
    const u = this.upP.mat.uniforms
    let cur = this.levels[this.levels.length - 1]
    for (let i = this.levels.length - 2; i >= 0; i--) {
      u.uMap.value = cur.texture
      u.uBase.value = this.levels[i].texture
      u.uTexel.value.set(1 / cur.width, 1 / cur.height)
      this.upP.render(r, this.up[i])
      cur = this.up[i]
    }
    return cur.texture
  }
}

/* ------------------------------------------------------------------ the portal
   One scale opens inside another. Lens style: a circle (centred anywhere on
   screen) grows until it fills the frame, its rim bending the outer world
   like the edge of a lens. Fade style: the two pictures dissolve, the outer
   one swelling slightly as if the camera were flying into it. */
export function portalPass() {
  return new FullScreen(
    sm(
      /* glsl */ `
      uniform sampler2D uMacro, uMicro; uniform float uR, uStyle; uniform vec2 uRes, uC;
      void main(){
        vec2 asp = vec2(uRes.x / uRes.y, 1.0);
        if (uStyle > 0.5) {
          // dissolve: the outer picture pushes in as it fades
          vec2 uvM = uC + (vUv - uC) / (1.0 + uR * 0.35);
          vec3 a = texture(uMacro, uvM).rgb;
          vec2 uvI = uC + (vUv - uC) * (1.0 + (1.0 - uR) * 0.25);
          vec3 b = texture(uMicro, uvI).rgb;
          float k = smoothstep(0.0, 1.0, uR);
          o = vec4(mix(a, b, k) + vec3(0.6, 0.75, 1.0) * sin(k * 3.14159) * 0.06, mix(texture(uMacro, vUv).a, 0.0, k));
          return;
        }
        vec2 p = (vUv - uC) * asp;
        float d = length(p);
        float far = length(max(abs(uC - 0.5) * asp, vec2(0.0)) + 0.5 * asp);
        float R = uR * far * 1.04;
        float inside = smoothstep(R, R - 0.004, d);
        // refraction around the rim: the outside world is pulled inward
        float rim = exp(-((d - R) / 0.05) * ((d - R) / 0.05)) * step(0.001, uR);
        vec2 dir = normalize(p + 1e-5);
        vec2 uvM = vUv - dir / asp * rim * 0.05;
        vec3 macro = texture(uMacro, uvM).rgb;
        // inside: the micro world is seen through a lens that de-magnifies at the edge
        float k = clamp(d / max(R, 1e-3), 0.0, 1.0);
        vec2 uvI = uC + (vUv - uC) * (0.82 + 0.18 * k * k);
        uvI = mix(uvI, vUv, smoothstep(0.7, 1.0, uR));
        vec3 microC = texture(uMicro, uvI).rgb;
        vec3 c = mix(macro, microC, inside);
        c += vec3(0.8, 0.9, 1.0) * rim * 0.25 * (1.0 - inside);
        o = vec4(c, texture(uMacro, vUv).a * (1.0 - inside));
      }`,
      { uMacro: { value: null }, uMicro: { value: null }, uR: { value: 0 }, uStyle: { value: 0 }, uC: { value: new THREE.Vector2(0.5, 0.5) }, uRes: U.uRes },
    ),
  )
}

/* ------------------------------------------------------------------ the microscope
   The particle cell writes a different signal for each kind of microscope;
   this pass turns that signal into what the instrument would show.
     0 fluorescence   light emitted by each dye (passes through)
     1 brightfield    unstained: transmitted light, barely absorbed
     2 stained        hematoxylin and eosin absorb their own colours
     3 phase-contrast density differences become dark bodies with bright halos
     4 DIC            density gradients become relief, lit from one side
     5 confocal       one optical section (the cell shader drops the rest)
     6 SEM            secondary electrons from the surface, edges brightest
     7 TEM            electrons scattered by heavy-metal stain in a thin slice
   Two modes can be on screen at once, split by a wipe. */
export function scopePass() {
  return new FullScreen(
    sm(
      /* glsl */ `
      ${HASH}
      uniform sampler2D uA, uB; uniform float uModeA, uModeB, uWipe, uWipeAmt, uTime; uniform vec2 uRes;
      float dens(sampler2D t, vec2 uv){ vec3 c = texture(t, uv).rgb; return c.r + c.g + c.b; }
      vec3 convert(sampler2D t, float mode, vec2 uv){
        vec3 s = texture(t, uv).rgb;
        if (mode < 0.5 || abs(mode - 5.0) < 0.5) return s;
        vec2 px = 1.0 / uRes;
        float g = hash12(uv * uRes + fract(uTime * 3.1) * 97.0) - 0.5;
        if (mode < 1.5) {
          // unstained: a pale halogen field, the cell a faint ghost with a thin refractive edge
          float d = dens(t, uv);
          float e = abs(dens(t, uv + vec2(px.x * 2.0, 0.0)) - dens(t, uv - vec2(px.x * 2.0, 0.0))) + abs(dens(t, uv + vec2(0.0, px.y * 2.0)) - dens(t, uv - vec2(0.0, px.y * 2.0)));
          vec3 bg = vec3(0.86, 0.83, 0.74);
          return bg * exp(-d * 2.4) * (1.0 - e * 1.5) + g * 0.012;
        }
        if (mode < 2.5) {
          vec3 bg = vec3(0.92, 0.9, 0.86);
          return bg * exp(-s * 9.0) + g * 0.01;
        }
        if (mode < 3.5) {
          float d = dens(t, uv);
          float a = 0.0;
          for (int i = 0; i < 12; i++) {
            float an = float(i) * 0.5236;
            a += dens(t, uv + vec2(cos(an), sin(an)) * px * 9.0);
          }
          a /= 12.0;
          d *= 5.0; a *= 5.0;
          float I = 0.46 - 0.22 * d + 0.75 * max(a - d, 0.0) - 0.1 * max(d - a, 0.0);
          return vec3(0.82, 0.93, 0.88) * clamp(I, 0.0, 1.4) + g * 0.02;
        }
        if (mode < 4.5) {
          vec2 dl = normalize(vec2(1.0, 1.0)) * px * 1.6;
          float I = 0.5 + 3.5 * (dens(t, uv + dl) - dens(t, uv - dl)) - 0.25 * dens(t, uv);
          return vec3(0.78, 0.76, 0.72) * clamp(I, 0.0, 1.4) + g * 0.015;
        }
        if (mode < 6.5) {
          // SEM: unsharp mask on the surface signal, cold grey
          float d = dot(s, vec3(0.3333));
          float b = 0.0;
          for (int i = 0; i < 8; i++) { float an = float(i) * 0.785; b += dot(texture(t, uv + vec2(cos(an), sin(an)) * px * 3.0).rgb, vec3(0.3333)); }
          b /= 8.0;
          float I = d + 0.9 * (d - b);
          return vec3(0.9, 0.92, 0.95) * max(I, 0.0) + g * 0.03;
        }
        // TEM: transmitted electrons through a stained thin section
        float d = dens(t, uv);
        return vec3(0.84, 0.84, 0.82) * exp(-d * 0.75) + g * 0.025;
      }
      void main(){
        vec3 a = convert(uA, uModeA, vUv);
        vec3 c = a;
        if (uWipeAmt > 0.001) {
          vec3 b = convert(uB, uModeB, vUv);
          float x = vUv.x;
          float side = smoothstep(uWipe + 0.0008, uWipe - 0.0008, x);
          c = mix(a, b, side);
          float line = exp(-((x - uWipe) * uRes.x / 1.4) * ((x - uWipe) * uRes.x / 1.4));
          c += vec3(1.0, 0.95, 0.85) * line * 1.4 * uWipeAmt;
        }
        o = vec4(c, 1.0);
      }`,
      { uA: { value: null }, uB: { value: null }, uModeA: { value: 0 }, uModeB: { value: 0 }, uWipe: { value: 0.5 }, uWipeAmt: { value: 0 }, uTime: U.uTime, uRes: U.uRes },
    ),
  )
}

/* ------------------------------------------------------------------ final grade */
export function finalPass() {
  return new FullScreen(
    sm(
      /* glsl */ `
      ${HASH}${NOISE}${TONE}
      uniform sampler2D uMap, uBloom;
      uniform float uExposure, uBloomAmt, uTime, uPaper, uVignette, uGrain, uScrollVel, uFlash, uCA, uSpotAmt, uLinear;
      uniform vec2 uRes;
      uniform vec3 uSpot;   // centre (uv) and radius (in screen heights) of what is being taught
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

      /* engraving: parallel hatch lines whose width follows density, a second
         crossed set for the darkest tones — the look of a 19th-c. atlas plate */
      float hatch(vec2 px, float dens, float ang){
        vec2 d = vec2(cos(ang), sin(ang));
        float wob = gnoise(vec3(px * 0.02, 1.0)) * 1.4;
        float v = fract(dot(px, d) / 5.0 + wob * 0.12);
        float w = clamp(dens, 0.0, 1.0) * 0.5;
        return smoothstep(w + 0.08, w - 0.04, abs(v - 0.5));
      }

      void main(){
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        float ca = (uCA + abs(uScrollVel) * 0.004) * dot(c, c);
        vec4 base = texture(uMap, uv);
        vec3 col;
        col.r = texture(uMap, uv - c * ca).r;
        col.g = base.g;
        col.b = texture(uMap, uv + c * ca).b;
        vec3 bloom = texture(uBloom, uv).rgb;
        // spotlight: outside the subject the frame softens (a small disc blur) and dims
        float out_ = 0.0;
        if (uSpotAmt > 0.002) {
          vec2 asp = vec2(uRes.x / uRes.y, 1.0);
          float d = length((uv - uSpot.xy) * asp);
          out_ = smoothstep(uSpot.z, uSpot.z * 1.7 + 0.05, d) * uSpotAmt;
          if (out_ > 0.01) {
            vec3 b = col;
            float rpx = 5.0 * out_;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.785398 + 0.3;
              b += texture(uMap, uv + vec2(cos(a), sin(a)) * rpx / uRes).rgb;
            }
            col = mix(col, b / 9.0, out_);
          }
        }
        col += bloom * uBloomAmt * (1.0 - out_ * 0.5);
        col *= 1.0 - out_ * 0.62;
        col *= uExposure;
        col += vec3(0.6, 0.7, 1.0) * uFlash * 0.03;
        // the microscope images are already "photographs": keep their whites white
        vec3 mapped = mix(aces(col), clamp(col, 0.0, 1.0), uLinear);

        // ---- the atlas plate ------------------------------------------------
        if (uPaper > 0.001) {
          vec2 px = uv * uRes;
          vec3 paper = vec3(0.925, 0.905, 0.862);
          paper *= 0.97 + 0.03 * gnoise(vec3(px * 0.35, 0.0));      // tooth
          paper *= 1.0 - 0.06 * smoothstep(0.3, 0.9, length(c * vec2(1.0, 1.3)));
          float lum = dot(mapped, vec3(0.299, 0.587, 0.114));
          vec3 hue = mapped / max(max(mapped.r, max(mapped.g, mapped.b)), 1e-3);
          vec3 ink = mix(vec3(0.07, 0.065, 0.06), hue * 0.32, 0.75);
          vec3 plate = mix(paper, ink, clamp(lum * 2.4, 0.0, 1.0));
          float dens = base.a;
          float h1 = hatch(px, dens * 1.1, 0.785);
          float h2 = hatch(px, (dens - 0.55) * 1.6, -0.785);
          vec3 inkLine = vec3(0.13, 0.12, 0.11);
          plate = mix(plate, inkLine, max(h1, h2) * step(0.05, dens) * 0.85);
          mapped = mix(mapped, plate, uPaper);
        }

        float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.8)));
        mapped *= mix(1.0, v, uVignette * (1.0 - uPaper * 0.7) * (1.0 - uLinear * 0.7));
        vec3 srgb = toSRGB(mapped);
        float g = hash12(uv * uRes + fract(uTime * 7.3) * 311.0) - 0.5;
        srgb += g * uGrain * (1.0 - uPaper * 0.5);
        o = vec4(srgb, 1.0);
      }`,
      {
        uMap: { value: null }, uBloom: { value: null }, uExposure: { value: 1 }, uBloomAmt: { value: 0.7 },
        uTime: U.uTime, uPaper: U.uPaper, uVignette: { value: 0.5 }, uGrain: { value: 0.04 },
        uScrollVel: U.uScrollVel, uFlash: U.uFlash, uCA: { value: 0.012 }, uRes: U.uRes,
        uSpot: { value: new THREE.Vector3(0.5, 0.5, 0.3) }, uSpotAmt: { value: 0 }, uLinear: { value: 0 },
      },
    ),
  )
}
