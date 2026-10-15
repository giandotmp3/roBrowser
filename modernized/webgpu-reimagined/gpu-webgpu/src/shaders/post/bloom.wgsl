// R-PP-004 bloom prefilter (soft knee on BT.709 luma) + composite (scene + bloom * intensity).
struct Bloom { texel : vec2f, threshold : f32, knee : f32, intensity : f32 };
@group(0) @binding(2) var<uniform> b : Bloom;
@group(0) @binding(3) var bloom_tex : texture_2d<f32>;

@fragment
fn fs_prefilter(i : VsOut) -> @location(0) vec4f {
  let o = b.texel * 4.0;
  let c = (textureSample(src, samp, i.uv + vec2f(-o.x, -o.y)) + textureSample(src, samp, i.uv + vec2f(o.x, -o.y))
         + textureSample(src, samp, i.uv + vec2f(-o.x, o.y)) + textureSample(src, samp, i.uv + vec2f(o.x, o.y))).rgb * 0.25;
  let l = luma(c);
  var soft = clamp(l - b.threshold + b.knee, 0.0, 2.0 * b.knee);
  soft = soft * soft / (4.0 * b.knee + 1e-5);
  let contrib = max(soft, l - b.threshold) / max(l, 1e-5);
  return vec4f(c * contrib, 1.0);
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let scene = textureSample(src, samp, i.uv);
  return vec4f(scene.rgb + textureSample(bloom_tex, samp, i.uv).rgb * b.intensity, 1.0);
}
