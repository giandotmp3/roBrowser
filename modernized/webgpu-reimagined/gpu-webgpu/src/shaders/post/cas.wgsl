// R-PP-007 CAS. FIX: sharpening may be 0 (no `|| 1.0` fallback). peak = 8 - 3 * contrast.
struct Cas { texel : vec2f, peak : f32, sharpening : f32 };
@group(0) @binding(2) var<uniform> u : Cas;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let c = textureSample(src, samp, i.uv).rgb;
  let n = textureSample(src, samp, i.uv + vec2f(0.0, -u.texel.y)).rgb;
  let s = textureSample(src, samp, i.uv + vec2f(0.0, u.texel.y)).rgb;
  let w = textureSample(src, samp, i.uv + vec2f(-u.texel.x, 0.0)).rgb;
  let e = textureSample(src, samp, i.uv + vec2f(u.texel.x, 0.0)).rgb;
  let mn = min(c, min(min(n, s), min(w, e)));
  let mx = max(c, max(max(n, s), max(w, e)));
  let amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3f(1e-5)), vec3f(0.0), vec3f(1.0)));
  let wgt = -amp / u.peak;
  let sharp = clamp((c + (n + s + w + e) * wgt) / (1.0 + 4.0 * wgt), vec3f(0.0), vec3f(1.0));
  return vec4f(mix(c, sharp, u.sharpening), 1.0);
}
