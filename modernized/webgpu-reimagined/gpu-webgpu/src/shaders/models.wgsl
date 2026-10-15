// C-05 static RSM batch (R-MAP-012, legacy Models.vs) and animated RSM (R-MAP-017, legacy
// Map/AnimatedModels.vs) share one fragment stage (R-MAP-013 FIX: animated models honour the
// lightmap preference too); R-MAP-020 occluder fade; R-MAP-004 fog. Textures are layers of a
// per-size-class array, sampled in their top-left size/class part (exact powers of two).
// The animated matrix palette is a storage buffer of every animated model of the map
// (architecture §2.2), one mat4 per (node, instance).
@group(0) @binding(2) var<storage, read> palette : array<mat4x4f>;
@group(1) @binding(0) var diffuse_tex : texture_2d_array<f32>;

struct ModelOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) light_weighting : f32,
  @location(2) alpha : f32,
  @location(3) world_pos : vec3f,
  @location(4) @interpolate(flat) layer : u32,
  @location(5) @interpolate(flat) scale : vec2f,
};

@vertex
fn vs_static(@location(0) position : vec3f, @location(1) normal : vec3f, @location(2) uv : vec2f,
             @location(3) alpha : f32, @location(4) layer : vec3f) -> ModelOut {
  var o : ModelOut;
  o.pos = gl_clip(u.projection * u.model_view * vec4f(position, 1.0));
  o.uv = uv;
  o.alpha = alpha;
  o.world_pos = position;
  o.layer = u32(layer.x);
  o.scale = layer.yz;
  let dot_product = dot(normal, u.light_dir);
  o.light_weighting = max(dot_product, 0.0);
  return o;
}

@vertex
fn vs_animated(@location(0) position : vec3f, @location(1) normal : vec3f, @location(2) uv : vec2f,
               @location(3) alpha : f32, @location(4) layer : vec3f, @location(5) matrix_index : f32) -> ModelOut {
  let m = palette[u32(i32(matrix_index))];
  let world_pos = m * vec4f(position, 1.0);
  let view_pos = u.model_view * world_pos;
  var o : ModelOut;
  o.pos = gl_clip(u.projection * view_pos);
  o.uv = uv;
  o.alpha = alpha;
  o.world_pos = world_pos.xyz;
  o.layer = u32(layer.x);
  o.scale = layer.yz;

  let c0 = normalize(m[0].xyz);
  let c1 = normalize(m[1].xyz);
  let c2 = normalize(m[2].xyz);
  let rot = mat3x3f(c0, c1, c2);
  let n = normalize(rot * normal);
  let light_weight = max(dot(n, u.light_dir), 0.0);
  o.light_weighting = (1.0 - u.light_opacity) + light_weight * u.light_opacity;
  return o;
}

@fragment
fn fs_main(i : ModelOut) -> @location(0) vec4f {
  var texture_sample = textureSample(diffuse_tex, samp, i.uv * i.scale, i.layer);

  if (texture_sample.a == 0.0) {
    discard;
  }

  var alpha = texture_sample.a;
  if (!occluder_fade(i.world_pos, &alpha, i.pos)) {
    discard;
  }
  texture_sample.a = alpha;

  let color = select(1.0, i.light_weighting, u.lightmap_use != 0u) * u.light_diffuse + u.light_ambient;
  texture_sample = vec4f(texture_sample.rgb * clamp(color, vec3f(0.0), vec3f(1.0)), texture_sample.a);
  texture_sample = vec4f(texture_sample.rgb * clamp(u.light_env, vec3f(0.0), vec3f(1.0)), texture_sample.a);
  texture_sample.a *= i.alpha;

  return apply_fog(texture_sample, i.pos, u.fog);
}
