// C-05 static + animated RSM. R-MAP-012 shading; R-MAP-013 FIX: animated models honour lightmap_on too.
struct Model {
  view_proj : mat4x4f,
  light_dir : vec3f, lightmap_on : u32,
  diffuse : vec3f, _p0 : f32,
  ambient : vec3f, _p1 : f32,
  env : vec3f, _p2 : f32,
  fog : Fog,
};
@group(0) @binding(0) var<uniform> model : Model;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) n : vec3f, @location(1) uv : vec2f, @location(2) alpha : f32 };

@vertex
fn vs_main(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f, @location(3) alpha : f32) -> VsOut {
  var o : VsOut;
  o.pos = model.view_proj * vec4f(p, 1.0);
  o.n = n; o.uv = uv; o.alpha = alpha;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let t = textureSample(tex, samp, i.uv);
  if (t.a == 0.0) { discard; }
  var nl = 1.0;
  if (model.lightmap_on != 0u) { nl = max(dot(i.n, model.light_dir), 0.0); }
  let rgb = t.rgb * clamp(nl * model.diffuse + model.ambient, vec3f(0.0), vec3f(1.0)) * clamp(model.env, vec3f(0.0), vec3f(1.0));
  return apply_fog(vec4f(rgb, t.a * i.alpha), i.pos, model.fog);
}
