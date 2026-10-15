// C-04 water: R-MAP-008 wave (legacy Map/Water.vs), R-MAP-009 frame (a layer of the
// 32-frame array, sampled in its top-left size/class part), R-MAP-010 FIX (opacity applied
// once; legacy squared it), texture alpha ignored, unlit; R-MAP-004 fog.
@group(0) @binding(2) var water_tex : texture_2d_array<f32>;

const PI : f32 = 3.14159265358979323846264;

struct WaterOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

// GLSL mod(): x - y * floor(x / y).
fn glsl_mod(x : f32, y : f32) -> f32 {
  return x - y * floor(x / y);
}

@vertex
fn vs_main(@location(0) position : vec3f, @location(1) uv : vec2f) -> WaterOut {
  let x = glsl_mod(position.x, 2.0);
  let y = glsl_mod(position.z, 2.0);
  let diff = select(0.0, select(-1.0, 1.0, y < 1.0), x < 1.0);
  let height = sin((PI / 180.0) * (u.water_offset + 0.5 * u.wave_pitch * (position.x + position.z + diff))) * u.wave_height;
  var o : WaterOut;
  o.pos = gl_clip(u.projection * u.model_view * vec4f(position.x, position.y + height, position.z, 1.0));
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(i : WaterOut) -> @location(0) vec4f {
  let rgb = textureSample(water_tex, samp, i.uv * u.scale, u.layer).rgb;
  if (u.opacity == 0.0) {
    discard;
  }
  return apply_fog(vec4f(rgb, u.opacity), i.pos, u.fog);
}
