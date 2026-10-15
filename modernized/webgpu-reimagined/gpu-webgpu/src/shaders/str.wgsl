// C-09 STR layers: instanced quad, one instance per STR EffectDraw record (instance-step vertex
// buffer, layout in effects/strInstance.js, 26 floats, byte-identical to gpu-webgl2). No per-vertex
// buffer: the strip vertex (vertex_index 0..3) picks its keyframe corner and its uv. Reproduces
// legacy Renderer/Effects/StrEffect.vs/.fs operation for operation (same as gpu-webgl2 str.vert/.frag):
// R-EFX-009 billboard: 1/35 world unit per px, pivot offset, Y lowered (yLower), clip z biased by
// clipZBias (-0.1); pure-black or zero-alpha products discarded. #40: keyframe uv ignored, full texture.
// R-EFX-010 (fixed): the layer obeys the scene fog (shared include) when its record asks for it.
// Clip space stays GL-style ([-w, w] z) until the very end, where z is remapped to WebGPU's [0, w]
// (as sprite.wgsl): z' = (z + w) / 2 gives exactly GL's window depth with the default depth range.
// Clip y is up in both APIs (same matrices as legacy); texel row 0 is the image's top row on both
// sides (legacy texImage2D(canvas) and the residency layer), so uv needs no flip.

struct Frame {
  model_view : mat4x4f,
  view_model : mat4x4f,   // unused here; same block as sprite.wgsl (packFrameUniforms)
  projection : mat4x4f,
  zoom : f32,
  fog : Fog,
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var samp_linear : sampler;            // LINEAR, clamp-to-edge (legacy WebGL.texture)
@group(0) @binding(2) var rgba0 : texture_2d_array<f32>;    // rgba8unorm pools by POT class 32..512
@group(0) @binding(3) var rgba1 : texture_2d_array<f32>;
@group(0) @binding(4) var rgba2 : texture_2d_array<f32>;
@group(0) @binding(5) var rgba3 : texture_2d_array<f32>;
@group(0) @binding(6) var rgba4 : texture_2d_array<f32>;

struct Instance {
  @location(0) position : vec3f,   // effect position (world)
  @location(1) quad_x : vec4f,     // corner x (sprite px, x scale) in strip order v0..v3
  @location(2) quad_y : vec4f,     // corner y
  @location(3) rotation : vec2f,   // (cos, sin) of -angle, as legacy mat4.rotateZ
  @location(4) offset : vec2f,     // pos - pivot (+ attachment offset), sprite px
  @location(5) color : vec4f,
  @location(6) str : vec3f,        // x: yLower, y: clip z bias, z: fog (R-EFX-010 fix)
  @location(7) tex : vec4f,        // x: array layer (-1 miss), y: POT class, zw: texture size / class size
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
  @location(3) @interpolate(flat) fog : f32,
};

const PIXEL_RATIO : f32 = 1.0 / 35.0;

// Legacy Project(): translate to (x, -z, y) + half a cell, then a spherical billboard.
fn project(m_in : mat4x4f, pos : vec3f) -> mat4x4f {
  var m = m_in;
  let x = pos.x + 0.5;
  let y = -pos.z;
  let z = pos.y + 0.5;

  m[3].x += m[0].x * x + m[1].x * y + m[2].x * z;
  m[3].y += m[0].y * x + m[1].y * y + m[2].y * z;
  m[3].z += m[0].z * x + m[1].z * y + m[2].z * z;
  m[3].w += m[0].w * x + m[1].w * y + m[2].w * z;

  m[0] = vec4f(1.0, 0.0, 0.0, m[0].w);
  m[1] = vec4f(0.0, 1.0, 0.0, m[1].w);
  m[2] = vec4f(0.0, 0.0, 1.0, m[2].w);

  return m;
}

@vertex
fn vs_main(@builtin(vertex_index) id : u32, inst : Instance) -> VsOut {
  // Legacy strip: v0 uv(0,0), v1 uv(1,0), v2 uv(0,1), v3 uv(1,1).
  var o : VsOut;
  o.uv = vec2f(f32(id & 1u), f32(id >> 1u));

  let angle = mat4x4f(
    inst.rotation.x, inst.rotation.y, 0.0, 0.0,
    -inst.rotation.y, inst.rotation.x, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0
  );
  var quad_x = inst.quad_x;
  var quad_y = inst.quad_y;
  let corner = vec2f(quad_x[id], quad_y[id]);

  var position = angle * vec4f(corner.x * PIXEL_RATIO, -corner.y * PIXEL_RATIO, 0.0, 1.0);
  position.x += inst.offset.x * PIXEL_RATIO;
  position.y -= inst.offset.y * PIXEL_RATIO + inst.str.x;

  var clip = frame.projection * project(frame.model_view, inst.position) * position;
  clip.z += inst.str.y;

  // GL clip z [-w, w] -> WebGPU [0, w] (same window depth as legacy).
  clip.z = (clip.z + clip.w) * 0.5;

  o.pos = clip;
  o.color = inst.color;
  o.tex = inst.tex;
  o.fog = inst.str.z;
  return o;
}

fn sample_layer(cls : i32, uv : vec2f, layer : i32) -> vec4f {
  switch cls {
    case 0: { return textureSampleLevel(rgba0, samp_linear, uv, layer, 0.0); }
    case 1: { return textureSampleLevel(rgba1, samp_linear, uv, layer, 0.0); }
    case 2: { return textureSampleLevel(rgba2, samp_linear, uv, layer, 0.0); }
    case 3: { return textureSampleLevel(rgba3, samp_linear, uv, layer, 0.0); }
    default: { return textureSampleLevel(rgba4, samp_linear, uv, layer, 0.0); }
  }
}

// The texture is an rgba8 texture-array layer (residency); the image sits in the layer's top-left
// corner, edge-replicated, so LINEAR over uv * (size / class) equals legacy's per-texture
// LINEAR + CLAMP_TO_EDGE.
@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  // Not resident (residency miss): nothing to draw.
  if (i.tex.x < 0.0) {
    discard;
  }
  let color = sample_layer(i32(i.tex.y), i.uv * i.tex.zw, i32(i.tex.x)) * i.color;
  // Legacy StrEffect.fs tests the product, not the texel.
  if (color.a == 0.0 || (color.r == 0.0 && color.g == 0.0 && color.b == 0.0)) {
    discard;
  }
  if (i.fog > 0.5) {
    return apply_fog(color, i.pos, frame.fog);
  }
  return color;
}
