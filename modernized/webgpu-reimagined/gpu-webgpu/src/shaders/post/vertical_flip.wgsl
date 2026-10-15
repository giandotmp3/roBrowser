// R-PP-011 consumer (EFST ILLUSION): flip the image vertically. Overlay/picking mirroring is owned by scene.
@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  return textureSample(src, samp, vec2f(i.uv.x, 1.0 - i.uv.y));
}
