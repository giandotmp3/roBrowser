// R-PP-007 CAS: legacy GLSL/CAS.fs operation for operation. FIX: sharpening 0 is honoured (the legacy
// `|| 1.0` fallback is gone, postChain.js casUniforms). peak = -3 * contrast + 8.
struct Cas { texel : vec2f, contrast : f32, sharpening : f32 };
@group(0) @binding(2) var<uniform> u : Cas;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  //  a b c
  //  d(e)f
  //  g h i
  let t = u.texel;
  let a = tex(i.uv + vec2f(-t.x, -t.y)).rgb;
  let b = tex(i.uv + vec2f(0.0, -t.y)).rgb;
  let c = tex(i.uv + vec2f(t.x, -t.y)).rgb;
  let d = tex(i.uv + vec2f(-t.x, 0.0)).rgb;
  let e = tex(i.uv).rgb;
  let f = tex(i.uv + vec2f(t.x, 0.0)).rgb;
  let g = tex(i.uv + vec2f(-t.x, t.y)).rgb;
  let h = tex(i.uv + vec2f(0.0, t.y)).rgb;
  let k = tex(i.uv + vec2f(t.x, t.y)).rgb;

  // Soft min and max.
  var mn_rgb = min(min(min(d, e), min(f, b)), h);
  let mn_rgb2 = min(mn_rgb, min(min(a, c), min(g, k)));
  mn_rgb += mn_rgb2;

  var mx_rgb = max(max(max(d, e), max(f, b)), h);
  let mx_rgb2 = max(mx_rgb, max(max(a, c), max(g, k)));
  mx_rgb += mx_rgb2;

  let rcp_m_rgb = 1.0 / mx_rgb;
  var amp_rgb = clamp(min(mn_rgb, 2.0 - mx_rgb) * rcp_m_rgb, vec3f(0.0), vec3f(1.0));
  amp_rgb = inverseSqrt(amp_rgb);

  let peak = -3.0 * u.contrast + 8.0;
  let w_rgb = -1.0 / (amp_rgb * peak);
  let rcp_weight_rgb = 1.0 / (4.0 * w_rgb + 1.0);

  // Cross filter.
  let window = (b + d) + (f + h);
  let out_color = clamp((window * w_rgb + e) * rcp_weight_rgb, vec3f(0.0), vec3f(1.0));

  return vec4f(mix(e, out_color, u.sharpening), 1.0);
}
