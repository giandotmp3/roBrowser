// R-PP-009 vibrance: legacy GLSL/Vibrance.fs. FIX: vibrance 0 is honoured (no `||` fallback to 0.15).
struct Vib { balance : vec3f, vibrance : f32 };
@group(0) @binding(2) var<uniform> u : Vib;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  var color = tex(i.uv).rgb;

  let coef_luma = vec3f(0.212656, 0.715158, 0.072186); // Rec. 709
  let luma = dot(coef_luma, color);

  let max_color = max(color.r, max(color.g, color.b));
  let min_color = min(color.r, min(color.g, color.b));
  let color_saturation = max_color - min_color;

  let coeff_vibrance = u.balance * u.vibrance;

  var strength = 1.0 + (coeff_vibrance.r * (1.0 - (sign(coeff_vibrance.r) * color_saturation)));
  color.r = mix(luma, color.r, strength);

  strength = 1.0 + (coeff_vibrance.g * (1.0 - (sign(coeff_vibrance.g) * color_saturation)));
  color.g = mix(luma, color.g, strength);

  strength = 1.0 + (coeff_vibrance.b * (1.0 - (sign(coeff_vibrance.b) * color_saturation)));
  color.b = mix(luma, color.b, strength);

  return vec4f(color, 1.0);
}
