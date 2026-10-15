// C-09 STR effects. R-EFX-009 billboard; R-EFX-010 FIX: fog honoured via the shared include.
struct Str {
  view_proj : mat4x4f,
  position : vec3f, attachment : u32,
  color : vec4f,
  fog : Fog,
};
@group(0) @binding(0) var<uniform> str_u : Str;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex
fn vs_main(@location(0) px : vec2f, @location(1) uv : vec2f) -> VsOut {
  var p = (px - vec2f(320.0)) / 35.0;
  if (str_u.attachment == 0u) { p.y -= 0.5; }
  var o : VsOut;
  o.pos = str_u.view_proj * vec4f(str_u.position + vec3f(p, 0.0), 1.0);
  o.pos.z -= 0.1;
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, i.uv);
  if (t.a == 0.0 || all(t.rgb == vec3f(0.0))) { discard; }
  return apply_fog(t * str_u.color, i.pos, str_u.fog);
}
