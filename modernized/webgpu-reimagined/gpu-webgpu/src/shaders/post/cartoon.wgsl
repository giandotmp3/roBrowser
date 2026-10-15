// R-PP-008 cartoon: rgb -= |edge|^slope * power, edge from diagonal luma differences.
struct Cartoon { texel : vec2f, power : f32, edge_slope : f32 };
@group(0) @binding(2) var<uniform> u : Cartoon;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let c = textureSample(src, samp, i.uv).rgb;
  let d1 = luma(textureSample(src, samp, i.uv + u.texel).rgb) - luma(textureSample(src, samp, i.uv - u.texel).rgb);
  let d2 = luma(textureSample(src, samp, i.uv + vec2f(u.texel.x, -u.texel.y)).rgb) - luma(textureSample(src, samp, i.uv + vec2f(-u.texel.x, u.texel.y)).rgb);
  let edge = length(vec2f(d1, d2));
  return vec4f(c - pow(abs(edge), u.edge_slope) * u.power, 1.0);
}
