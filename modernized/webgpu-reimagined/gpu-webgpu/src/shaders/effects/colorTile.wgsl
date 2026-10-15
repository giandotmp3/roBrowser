// flat-color-tile: legacy FlatColorTile.vs/.fs (no texture, no fog). The colour stays a smooth
// varying, as legacy passes uColor through one. Legacy binds the x, y, u, v quad and reads x, y.

struct VertexIn {
  @location(0) aPosition : vec2f,
  @location(1) _uv : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iColor : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z, v.iPosition.y + 0.5, 1.0);
  position += vec4f(v.aPosition.x * v.iPosition.w, 0.0, v.aPosition.y * v.iPosition.w, 0.0);
  var clip = frame.projection * frame.model_view * position;
  clip.z -= 0.01;
  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.color = v.iColor;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  return i.color;
}
