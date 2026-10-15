// R-PP-004 bloom: legacy GLSL/Bloom.fs (prefilter, into the 0.25x / 0.125x internal target) and
// GLSL/BloomUpsampling.fs (composite: scene + bloom * intensity).
struct Bloom { texel : vec2f, threshold : f32, soft_knee : f32, intensity : f32 };
@group(0) @binding(2) var<uniform> b : Bloom;
@group(0) @binding(3) var bloom_tex : texture_2d<f32>;

fn bloom_luminance(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722)); // BT.709
}

fn bloom_threshold(l : f32, threshold : f32, knee : f32) -> f32 {
  var soft = l - threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  return max(soft * soft / (4.0 * knee + 1e-6), l - threshold) / max(l, 1e-6);
}

fn load_and_reduce(uv : vec2f, texel_size : vec2f) -> vec3f {
  let offset = texel_size * 0.5;
  let c0 = tex(uv + vec2f(-offset.x, -offset.y)).rgb;
  let c1 = tex(uv + vec2f(offset.x, -offset.y)).rgb;
  let c2 = tex(uv + vec2f(-offset.x, offset.y)).rgb;
  let c3 = tex(uv + vec2f(offset.x, offset.y)).rgb;
  return (c0 + c1 + c2 + c3) * 0.25;
}

@fragment
fn fs_prefilter(i : VsOut) -> @location(0) vec4f {
  let color = load_and_reduce(i.uv, b.texel);
  let l = bloom_luminance(color);
  let contribution = bloom_threshold(l, b.threshold, b.threshold * b.soft_knee);
  return vec4f(color * contribution, 1.0);
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let original = tex(i.uv).rgb;
  let bloom = textureSampleLevel(bloom_tex, samp, i.uv, 0.0).rgb; // bilinear upsampling
  return vec4f(original + (bloom * b.intensity), 1.0);
}
