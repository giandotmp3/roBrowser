// Ground rings (families property-ground, magic-ring): legacy PropertyGround.vs/.fs and
// MagicRing.vs/.fs (as gpu-webgl2 ring.vert/.frag). iShape = (uTopSize, uBottomSize, uHeight,
// alpha), iRotation0..3 = uRotationMat columns, iPosition.w = fog.

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iShape : vec4f,
  @location(4) iRotation0 : vec4f,
  @location(5) iRotation1 : vec4f,
  @location(6) iRotation2 : vec4f,
  @location(7) iRotation3 : vec4f,
  @location(8) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) shade : vec2f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  var size : f32;
  var height : f32;
  let uRotationMat = mat4x4f(v.iRotation0, v.iRotation1, v.iRotation2, v.iRotation3);

  if (v.aPosition.z == 1.0) {
    size = v.iShape.x;
    height = v.iShape.z;
  } else {
    size = v.iShape.y;
    height = 0.0;
  }

  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z - height, v.iPosition.y + 0.5, 1.0);
  position += vec4f(v.aPosition.x * size, 0.0, v.aPosition.y * size, 0.0) * uRotationMat;

  let clip = frame.projection * frame.model_view * position;
  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.shade = vec2f(v.iShape.w, v.iPosition.w);
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  var textureSample = effect_texture(i.tex, i.uv);
  if (textureSample.a == 0.0) {
    discard;
  }
  if (textureSample.r < 0.5 || textureSample.g < 0.5 || textureSample.b < 0.5) {
    discard;
  }
  textureSample.a = i.shade.x;
  var fragColor = textureSample;
  if (i.shade.y > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
