// R-PP-003 upsampling: legacy GLSL/CommonUpsampling.fs, a linear sample of the 0.75x scene to full size.
// Also the chain's copy when no module is active (same-size, texel centres: exact).
@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  return vec4f(tex(i.uv).rgb, 1.0);
}
