// C-03 ground. R-MAP-001 shading, R-MAP-002 lightmap posterise, R-MAP-003 alpha cutout.
struct Scene {
  view_proj : mat4x4f,
  light_dir : vec3f, lightmap_on : u32,
  diffuse : vec3f, smoothlight : u32,
  ambient : vec3f, _pad0 : f32,
  env : vec3f, _pad1 : f32,
  fog : Fog,
};
@group(0) @binding(0) var<uniform> scene : Scene;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var atlas : texture_2d<f32>;
@group(0) @binding(3) var lightmap : texture_2d<f32>;
@group(0) @binding(4) var tile_color : texture_2d<f32>;

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) normal : vec3f,
  @location(1) uv : vec2f,
  @location(2) lm_uv : vec2f,
  @location(3) tc_uv : vec2f,
};

@vertex
fn vs_main(@location(0) p : vec3f, @location(1) n : vec3f, @location(2) uv : vec2f,
           @location(3) lm_uv : vec2f, @location(4) tc_uv : vec2f) -> VsOut {
  var o : VsOut;
  o.pos = scene.view_proj * vec4f(p, 1.0);
  o.normal = n; o.uv = uv; o.lm_uv = lm_uv; o.tc_uv = tc_uv;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let tex = textureSample(atlas, samp, i.uv);
  if (tex.a < 0.1) { discard; }
  var rgb = tex.rgb;
  if (any(i.tc_uv != vec2f(0.0))) {
    rgb *= textureSample(tile_color, samp, i.tc_uv).rgb;
  }
  let nl = max(dot(i.normal, scene.light_dir), 0.0);
  rgb *= clamp(nl * scene.diffuse + scene.ambient, vec3f(0.0), vec3f(1.0));
  rgb *= clamp(scene.env, vec3f(0.0), vec3f(1.0));
  if (scene.lightmap_on != 0u) {
    let lm = textureSample(lightmap, samp, i.lm_uv);
    var lrgb = lm.rgb;
    if (scene.smoothlight == 0u) { lrgb = floor(lrgb * 255.0 / 16.0) * 16.0 / 255.0; }
    else if (scene.smoothlight == 2u) { lrgb = pow(lrgb, vec3f(1.1)); }
    rgb = rgb * lm.a + clamp(lrgb, vec3f(0.0), vec3f(1.0));
  }
  return apply_fog(vec4f(rgb, tex.a), i.pos, scene.fog);
}
