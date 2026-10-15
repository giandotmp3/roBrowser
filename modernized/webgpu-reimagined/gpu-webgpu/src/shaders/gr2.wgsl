// C-14 GR2. R-GR2-002 hard alpha test at 207/255; opaque output; bones in a storage buffer (48 max).
struct Gr2 { view_proj : mat4x4f, light_dir : vec3f, diffuse : f32, ambient : vec3f, alpha : f32 };
@group(0) @binding(0) var<uniform> g : Gr2;
@group(0) @binding(1) var<storage, read> bones : array<mat4x4f, 48>;
@group(0) @binding(2) var samp : sampler;
@group(0) @binding(3) var tex : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) n : vec3f, @location(1) uv : vec2f };

@vertex
fn vs_main(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f,
           @location(3) bi : vec4u, @location(4) bw : vec4f) -> VsOut {
  let skin = bones[bi.x] * bw.x + bones[bi.y] * bw.y + bones[bi.z] * bw.z + bones[bi.w] * bw.w;
  var o : VsOut;
  o.pos = g.view_proj * skin * vec4f(p, 1.0);
  o.n = (skin * vec4f(n, 0.0)).xyz;
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, i.uv);
  if (t.a < 207.0 / 255.0) { discard; }
  let nl = max(dot(normalize(i.n), g.light_dir), 0.0);
  let rgb = t.rgb * clamp(vec3f(nl * g.diffuse) + g.ambient, vec3f(0.0), vec3f(1.0));
  return vec4f(rgb, g.alpha);
}
