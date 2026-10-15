// R-PP-003 upsampling: linear sample of the 0.75x scene to full size.
@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  return textureSample(src, samp, i.uv);
}
