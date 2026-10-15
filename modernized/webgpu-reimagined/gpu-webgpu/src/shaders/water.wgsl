// C-04 water. R-MAP-008 wave, R-MAP-010 FIX (opacity applied once), unlit, texture alpha ignored.
struct Water {
  view_proj : mat4x4f,
  wave_offset : f32, wave_pitch : f32, wave_height : f32, opacity : f32,
  fog : Fog,
};
@group(0) @binding(0) var<uniform> water : Water;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var frames : texture_2d_array<f32>;
@group(0) @binding(3) var<uniform> frame_index : u32;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex
fn vs_main(@location(0) p : vec3f, @location(1) uv : vec2f, @location(2) diff : f32) -> VsOut {
  var q = p;
  q.y += sin(radians(water.wave_offset + 0.5 * water.wave_pitch * (p.x + p.z + diff))) * water.wave_height;
  var o : VsOut;
  o.pos = water.view_proj * vec4f(q, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let tex = textureSample(frames, samp, i.uv, frame_index);
  return apply_fog(vec4f(tex.rgb, water.opacity), i.pos, water.fog);
}
