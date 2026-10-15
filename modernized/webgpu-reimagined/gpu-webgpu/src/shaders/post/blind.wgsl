// R-PP-010 blind: legacy GLSL/Blind.fs. Darken toward black outside radius over falloff, aspect = (w / h, 1).
struct Blind { aspect : vec2f, radius : f32, falloff : f32 };
@group(0) @binding(2) var<uniform> u : Blind;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let uv = (i.uv - 0.5) * u.aspect;
  let dist = length(uv);
  let original = tex(i.uv).rgb;
  let effect_mask = smoothstep(u.radius, u.radius + u.falloff, dist);

  if (effect_mask <= 0.01) {
    return tex(i.uv);
  }
  let final_color = mix(original, vec3f(0.0), effect_mask);
  return vec4f(final_color, 1.0);
}
