// R-PP-008 cartoon: legacy GLSL/Cartoon.fs. rgb = clamp(|edge|^slope * -power + rgb), edge = diff1^2 + diff2^2
// from the diagonal BT.709 luma differences.
struct Cartoon { texel : vec2f, power : f32, edge_slope : f32 };
@group(0) @binding(2) var<uniform> u : Cartoon;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let color = tex(i.uv).rgb;
  let coef_luma = vec3f(0.2126, 0.7152, 0.0722);

  var diff1 = dot(coef_luma, tex(i.uv + u.texel).rgb);
  diff1 = dot(vec4f(coef_luma, -1.0), vec4f(tex(i.uv - u.texel).rgb, diff1));

  var diff2 = dot(coef_luma, tex(i.uv + u.texel * vec2f(1.0, -1.0)).rgb);
  diff2 = dot(vec4f(coef_luma, -1.0), vec4f(tex(i.uv + u.texel * vec2f(-1.0, 1.0)).rgb, diff2));

  let edge = dot(vec2f(diff1, diff2), vec2f(diff1, diff2));

  let result = clamp(pow(abs(edge), u.edge_slope) * -u.power + color, vec3f(0.0), vec3f(1.0));
  return vec4f(result, 1.0);
}
