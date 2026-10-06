/* Shared GLSL. Everything is procedural — no textures are ever loaded. */

export const HASH = /* glsl */ `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yzz)*p3.zyx); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
`

export const NOISE = /* glsl */ `
float gnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float n = 0.0;
  for(int dz=0; dz<2; dz++)
  for(int dy=0; dy<2; dy++)
  for(int dx=0; dx<2; dx++){
    vec3 o = vec3(float(dx),float(dy),float(dz));
    vec3 g = normalize(hash33(i+o)*2.0-1.0);
    float w = mix(1.0-u.x,u.x,o.x)*mix(1.0-u.y,u.y,o.y)*mix(1.0-u.z,u.z,o.z);
    n += w * dot(g, f-o);
  }
  return n*1.35;
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*gnoise(p); n += a; p = p*2.03 + 17.1; a *= 0.5; }
  return s/n;
}
float fbm2(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*vnoise(p); n += a; p = p*2.03 + 17.1; a *= 0.5; }
  return s/n;
}
float worley(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d = 1.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 o = vec3(float(x),float(y),float(z));
    vec3 r = o + hash33(i+o) - f;
    d = min(d, dot(r,r));
  }
  return sqrt(d);
}
`

export const TONE = /* glsl */ `
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
`

/* 2-D distance helpers for the flat sets (drawings, plates) */
export const SDF2 = /* glsl */ `
float smin(float a, float b, float k){ k = max(k, 1e-5); float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0); return length(pa - ba*h); }
float sdBox2(vec2 p, vec2 b){ vec2 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,q.y),0.0); }
float sdRBox2(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
float sdHex(vec2 p, float r){ const vec3 k = vec3(-0.866025404,0.5,0.577350269); p = abs(p); p -= 2.0*min(dot(k.xy,p),0.0)*k.xy; p -= vec2(clamp(p.x, -k.z*r, k.z*r), r); return length(p)*sign(p.y); }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
/* coverage of a filled shape and of a stroke, anti-aliased over px */
float fillA(float d, float px){ return clamp(0.5 - d/px, 0.0, 1.0); }
float strokeA(float d, float w, float px){ return clamp(0.5 - (abs(d) - w)/px, 0.0, 1.0); }
/* premultiplied "over" */
vec4 over(vec4 top, vec4 bot){ return vec4(top.rgb + bot.rgb*(1.0 - top.a), top.a + bot.a*(1.0 - top.a)); }
`

/* 3-D distance helpers and the shared look of the raymarched sets */
export const SDF3 = /* glsl */ `
float smin(float a, float b, float k){ k = max(k, 1e-4); float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r; }
float sdCapsule(vec3 p, float h, float r){ p.x -= clamp(p.x, -h, h); return length(p) - r; }
float sdSeg3(vec3 p, vec3 a, vec3 b){ vec3 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0); return length(pa - ba*h); }
float sdTorus(vec3 p, float R, float r){ return length(vec2(length(p.xz) - R, p.y)) - r; }
float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x,d.y),0.0) + length(max(d,0.0)); }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0-1.0)/max(k1, 1e-6); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`

export const RAY = /* glsl */ `
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform float uTime;
const float PI = 3.14159265;
vec3 rayDir(vec2 uv){
  vec4 p = uInvVP * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(p.xyz / p.w - uCamPos);
}
/* window depth of a world point, so raster meshes can be drawn into the same frame */
float depthOf(vec3 p){ vec4 c = uVP * vec4(p, 1.0); return clamp(c.z / c.w * 0.5 + 0.5, 0.0, 1.0); }
/* a studio: soft key light upper left, a cool strip right, dark floor */
vec3 env(vec3 d){
  vec3 c = mix(vec3(0.006, 0.008, 0.014), vec3(0.03, 0.04, 0.06), smoothstep(-0.2, 0.8, d.y));
  c += vec3(1.0, 0.96, 0.92) * 2.0 * smoothstep(0.9, 0.985, dot(d, normalize(vec3(-0.55, 0.62, 0.55))));
  c += vec3(0.45, 0.8, 1.0) * 1.4 * smoothstep(0.1, 0.0, abs(d.x - 0.78)) * smoothstep(-0.3, 0.2, d.y) * smoothstep(0.9, 0.2, d.y);
  return c;
}
/* the dark, faintly granular fluid a cell sits in, with far-off defocused bodies */
vec3 backdrop(vec3 d, float tint){
  vec3 c = mix(vec3(0.004, 0.006, 0.012), vec3(0.018, 0.028, 0.045), smoothstep(-0.6, 0.9, d.y));
  vec2 p = d.xy / (1.2 - d.z * 0.2);
  for (int i = 0; i < 12; i++) {
    vec3 h = hash33(vec3(float(i), 3.0, 9.0));
    vec2 ctr = (h.xy - 0.5) * vec2(2.6, 1.6) + vec2(sin(uTime*0.03 + h.z*6.0), cos(uTime*0.02 + h.x*5.0)) * 0.05;
    float R = mix(0.04, 0.2, h.z * h.z);
    float dd = length(p - ctr);
    float disc = smoothstep(R, R * 0.9, dd);
    float ring = smoothstep(R * 0.75, R, dd) * disc;
    vec3 col = mix(vec3(0.35, 0.7, 1.0), vec3(1.0, 0.5, 0.45), h.x * tint);
    c += col * (disc * 0.02 + ring * 0.04) * (0.3 + h.y);
  }
  return c;
}
`
