// R-PP-005 peripheral blur: legacy GLSL/GaussianBlur.fs. texel = blurIntensity / canvas size.
struct Blur { texel : vec2f, radius : f32, falloff : f32 };
@group(0) @binding(2) var<uniform> u : Blur;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let dist = distance(i.uv, vec2f(0.5));
  let original = tex(i.uv).rgb;
  let effect_mask = smoothstep(u.radius, u.radius + u.falloff, dist);
  if (effect_mask <= 0.01) {
    return tex(i.uv);
  }
  let offset = u.texel * (effect_mask * 0.5);
  let c0 = tex(i.uv + vec2f(-offset.x, -offset.y)).rgb;
  let c1 = tex(i.uv + vec2f(offset.x, -offset.y)).rgb;
  let c2 = tex(i.uv + vec2f(-offset.x, offset.y)).rgb;
  let c3 = tex(i.uv + vec2f(offset.x, offset.y)).rgb;
  let blurred = (c0 + c1 + c2 + c3) * 0.25;
  return vec4f(mix(original, blurred, effect_mask), 1.0);
}
