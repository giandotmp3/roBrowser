// R-PP-010 blind: darken toward black outside radius over falloff, aspect-corrected.
struct Blind { radius : f32, falloff : f32, aspect : f32, _p : f32 };
@group(0) @binding(2) var<uniform> u : Blind;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let d = distance(vec2f(i.uv.x * u.aspect, i.uv.y), vec2f(0.5 * u.aspect, 0.5));
  let k = 1.0 - smoothstep(u.radius, u.radius + u.falloff, d);
  return vec4f(textureSample(src, samp, i.uv).rgb * k, 1.0);
}
