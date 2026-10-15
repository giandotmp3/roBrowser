// World passes (ground, grid selector, water, static and animated RSM): one uniform block per
// draw (dynamic offset), the GL uniforms of the legacy world shaders in one struct
// (src/world/MapWorld.js packWorldUniforms writes it; keep the two in step).
// Clip space stays GL-style ([-w, w] z) until the end, where z is remapped to WebGPU's
// [0, w] (z' = (z + w) / 2: GL's window depth with the default depth range), as sprite.wgsl.
struct World {
  model_view : mat4x4f,
  projection : mat4x4f,
  light_dir : vec3f, light_opacity : f32,
  light_ambient : vec3f, lightmap_use : u32,
  light_diffuse : vec3f, smooth_light : u32,
  light_env : vec3f, occ_mode : u32,
  occ_eye : vec3f, occ_radius : f32,
  occ_focus : vec3f, occ_opacity : f32,
  occ_strength : f32, wave_height : f32, wave_pitch : f32, water_offset : f32,
  opacity : f32, layer : u32, scale : vec2f,
  target_height : f32, flip_y : f32, _pad1 : f32, _pad2 : f32,
  fog : Fog,
};

@group(0) @binding(0) var<uniform> u : World;
@group(0) @binding(1) var samp : sampler;

fn gl_clip(c : vec4f) -> vec4f {
  return vec4f(c.x, c.y, (c.z + c.w) * 0.5, c.w);
}
