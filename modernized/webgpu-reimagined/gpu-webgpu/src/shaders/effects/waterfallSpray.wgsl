// waterfallSpray: legacy WaterfallParticle.vs/.fs (as gpu-webgl2 waterfallSpray.vert/.frag; fog
// fades alpha; uColor is the record colour). One instance per seed (aSeed), the record's fields
// repeated on each: iModel0..3 = uModelMat columns, iMisc = (uTime, uSize, fog).

struct VertexIn {
  @location(0) aCorner : vec2f,
  @location(1) aSeed : vec4f,
  @location(2) iModel0 : vec4f,
  @location(3) iModel1 : vec4f,
  @location(4) iModel2 : vec4f,
  @location(5) iModel3 : vec4f,
  @location(6) iMisc : vec4f,
  @location(7) iColor : vec4f,
  @location(8) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) alpha : f32,
  @location(2) @interpolate(flat) color : vec4f,
  @location(3) @interpolate(flat) tex : vec4f,
  @location(4) @interpolate(flat) fog : f32,
};

// Spray puffs rise from the pool for RISE units after waiting below it.
const CYCLE : f32 = 38.0;
const RISE : f32 = 8.0;
const DELAY : f32 = CYCLE - RISE;

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uModelMat = mat4x4f(v.iModel0, v.iModel1, v.iModel2, v.iModel3);
  let uTime = v.iMisc.x;
  let uSize = v.iMisc.y;
  var o : VsOut;
  o.color = v.iColor;
  o.tex = v.iTex;
  o.fog = v.iMisc.z;

  let life = fract(v.aSeed.z + uTime);
  let t = life * CYCLE - DELAY;

  if (t <= 0.0) {
    // Legacy gl_Position = (2, 2, 2, 1): outside the clip volume in both APIs.
    o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    o.uv = vec2f(0.0);
    o.alpha = 0.0;
    return o;
  }

  let progress = t / RISE;
  let drift = sin(v.aSeed.w + progress * 3.0) * 0.3;
  let local = vec3f(v.aSeed.x + drift, -t * 0.2, v.aSeed.y);
  var viewPosition = frame.model_view * uModelMat * vec4f(local, 1.0);
  viewPosition = vec4f(viewPosition.xy + v.aCorner * uSize, viewPosition.z, viewPosition.w);

  o.pos = gl_to_webgpu(frame.projection * viewPosition);
  o.uv = v.aCorner * 0.5 + 0.5;
  o.alpha = 0.08 * min(1.0, progress * 8.0) * (1.0 - smoothstep(0.5, 1.0, progress));
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  var fragColor = effect_texture(i.tex, i.uv);
  fragColor = vec4f(fragColor.rgb * i.color.rgb, fragColor.a);
  fragColor.a *= i.alpha;
  if (i.fog > 0.5) {
    let fogFactor = effect_fog_factor(i.pos);
    fragColor.a *= 1.0 - fogFactor;
  }
  if (fragColor.a < 0.01) {
    discard;
  }
  return fragColor;
}
