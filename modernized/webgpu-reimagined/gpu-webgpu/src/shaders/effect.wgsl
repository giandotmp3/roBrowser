// C-09 generic 2D/3D/cylinder/aura effect quads. R-MAP-004 fog via include.
struct Effect { view_proj : mat4x4f, fog : Fog };
@group(0) @binding(0) var<uniform> fx : Effect;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f, @location(1) color : vec4f };

@vertex
fn vs_main(@location(0) p : vec3f, @location(1) uv : vec2f, @location(2) color : vec4f) -> VsOut {
  var o : VsOut;
  o.pos = fx.view_proj * vec4f(p, 1.0);
  o.uv = uv; o.color = color;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, i.uv) * i.color;
  if (t.a == 0.0) { discard; }
  return apply_fog(t, i.pos, fx.fog);
}
