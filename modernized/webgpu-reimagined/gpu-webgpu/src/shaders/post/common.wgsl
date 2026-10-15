// Shared full-screen triangle for post passes.
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o : VsOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn luma(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
