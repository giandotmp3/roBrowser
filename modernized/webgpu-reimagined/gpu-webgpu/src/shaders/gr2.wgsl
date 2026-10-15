// C-14 GR2 skinned mesh: legacy Renderer/GR2/GR2Model.vs + GR2Model.fs (and gpu-webgl2's
// gr2.vert/gr2.frag) operation for operation.
// - Bones (R-GR2-003): one 48-matrix palette per instance, a range of the frame's palette
//   buffer bound with a dynamic offset (gpu-webgl2: a std140 block bound with bindBufferRange).
// - R-GR2-002: hard alpha test, texels with alpha < 207/255 are discarded and the rest are
//   opaque (u.alpha is the entity alpha, 1 unless fading).
// - R-GR2-001: per-model grey diffuse/ambient (u.light_diffuse/u.light_ambient).
// - R-MAP-004 fog: the shared include (legacy mix(fragColor, vec4(fogColor, a), f)).
// Clip space stays GL-style ([-w, w] z) until the end, where z is remapped to WebGPU's
// [0, w] (z' = (z + w) / 2), as the world and sprite shaders.
struct Gr2 {
  model_view : mat4x4f,       // view * instance world
  projection : mat4x4f,
  normal_mat : mat3x3f,       // normal matrix of (view * world)
  light_dir : vec3f,          // map light direction, view space
  light_opacity : f32,
  light_ambient : vec3f,
  alpha_ref : f32,            // 207/255, a uniform as in legacy so the float is identical
  light_diffuse : vec3f,
  alpha : f32,
  light_env : vec3f,
  _pad : f32,
  fog : Fog,
};

@group(0) @binding(0) var<uniform> u : Gr2;
// R-GR2-003: at most 48 bones (GR2_MAX_BONES).
@group(0) @binding(1) var<uniform> bones : array<mat4x4f, 48>;
@group(0) @binding(2) var samp : sampler;
@group(1) @binding(0) var diffuse_tex : texture_2d<f32>;

struct Gr2Out {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) light_weighting : f32,
};

fn gl_clip(c : vec4f) -> vec4f {
  return vec4f(c.x, c.y, (c.z + c.w) * 0.5, c.w);
}

@vertex
fn vs_main(@location(0) position : vec3f, @location(1) normal : vec3f, @location(2) uv : vec2f,
           @location(3) bone_index : vec4f, @location(4) bone_weight : vec4f) -> Gr2Out {
  let skin = bone_weight.x * bones[u32(i32(bone_index.x))]
           + bone_weight.y * bones[u32(i32(bone_index.y))]
           + bone_weight.z * bones[u32(i32(bone_index.z))]
           + bone_weight.w * bones[u32(i32(bone_index.w))];

  let skinned = skin * vec4f(position, 1.0);
  var o : Gr2Out;
  // GLSL evaluates uProjectionMat * uModelViewMat * skinned left to right.
  o.pos = gl_clip((u.projection * u.model_view) * skinned);

  o.uv = uv;

  let skin3 = mat3x3f(skin[0].xyz, skin[1].xyz, skin[2].xyz);
  let n = normalize(u.normal_mat * (skin3 * normal));
  let light_weight = max(dot(n, u.light_dir), 0.0);
  o.light_weighting = (1.0 - u.light_opacity) + light_weight * u.light_opacity;
  return o;
}

@fragment
fn fs_main(i : Gr2Out) -> @location(0) vec4f {
  var texture_sample = textureSample(diffuse_tex, samp, i.uv);
  if (texture_sample.a < u.alpha_ref) {
    discard;
  }
  let color = i.light_weighting * u.light_diffuse + u.light_ambient;
  var rgb = texture_sample.rgb * clamp(color, vec3f(0.0), vec3f(1.0));
  rgb = rgb * clamp(u.light_env, vec3f(0.0), vec3f(1.0));
  return apply_fog(vec4f(rgb, u.alpha), i.pos, u.fog);
}
