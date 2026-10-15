// R-PP-011 consumer (EFST ILLUSION): legacy GLSL/VerticalFlip.fs. Overlay/picking mirroring is owned by scene.
@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  return tex(vec2f(i.uv.x, 1.0 - i.uv.y));
}
