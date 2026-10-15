// R-PP-009 vibrance. FIX: vibrance 0 honoured (no `||` fallback to 0.15).
struct Vib { balance : vec3f, vibrance : f32 };
@group(0) @binding(2) var<uniform> u : Vib;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let c = textureSample(src, samp, i.uv).rgb;
  let l = luma(c);
  let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  let v = u.vibrance * u.balance;
  return vec4f(mix(vec3f(l), c, vec3f(1.0) + v * (vec3f(1.0) - sign(v) * sat)), 1.0);
}
