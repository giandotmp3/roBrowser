// R-PP-005 peripheral blur: mask = smoothstep(r, r + falloff, dist); 4-tap box offset by texel * intensity * 0.5 * mask.
struct Blur { texel : vec2f, radius : f32, falloff : f32 };
@group(0) @binding(2) var<uniform> u : Blur;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let mask = smoothstep(u.radius, u.radius + u.falloff, distance(i.uv, vec2f(0.5)));
  let o = u.texel * 0.5 * mask;
  let blurred = (textureSample(src, samp, i.uv + vec2f(-o.x, -o.y)) + textureSample(src, samp, i.uv + vec2f(o.x, -o.y))
               + textureSample(src, samp, i.uv + vec2f(-o.x, o.y)) + textureSample(src, samp, i.uv + vec2f(o.x, o.y))) * 0.25;
  return mix(textureSample(src, samp, i.uv), blurred, mask);
}
