// spirit-sphere / warlock-sphere: legacy SpiritSphere.vs/.fs = WarlockSphere.vs/.fs (as
// gpu-webgl2 sphere.vert/.frag; texture x colour, no discard, no fog). iPosition = (uPosition,
// uSize), iDepth = (uZIndex, uCameraZoom), iTexRot0..3 = uTextureRotMat columns, iRotation0..3 =
// uRotationMat columns.

struct VertexIn {
  @location(0) aPosition : vec2f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iDepth : vec4f,
  @location(4) iTexRot0 : vec4f,
  @location(5) iTexRot1 : vec4f,
  @location(6) iTexRot2 : vec4f,
  @location(7) iTexRot3 : vec4f,
  @location(8) iRotation0 : vec4f,
  @location(9) iRotation1 : vec4f,
  @location(10) iRotation2 : vec4f,
  @location(11) iRotation3 : vec4f,
  @location(12) iColor : vec4f,
  @location(13) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uTextureRotMat = mat4x4f(v.iTexRot0, v.iTexRot1, v.iTexRot2, v.iTexRot3);
  let uRotationMat = mat4x4f(v.iRotation0, v.iRotation1, v.iRotation2, v.iRotation3);

  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z - 2.0, v.iPosition.y + 0.5, 1.0);

  var pos2 = vec4f(v.aPosition.x * v.iPosition.w, 0.0, v.aPosition.y * v.iPosition.w, 0.0) * uTextureRotMat;
  pos2.x += 1.0;
  position += pos2 * uRotationMat;

  var clip = frame.projection * frame.model_view * position;
  clip.z -= v.iDepth.x / max(v.iDepth.y, 1.0);

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.color = v.iColor;
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  var textureSample = effect_texture(i.tex, i.uv);
  textureSample *= i.color;
  return textureSample;
}
