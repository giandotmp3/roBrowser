// cylinder: legacy Cylinder.vs/.fs (as gpu-webgl2 cylinder.vert/.frag). iPosition = (uPosition,
// uZindex), iShape = (uTopSize, uBottomSize, uHeight, uRotate), iRotation0..3 = uRotationMat
// columns, iMisc.x = fog.

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iShape : vec4f,
  @location(4) iRotation0 : vec4f,
  @location(5) iRotation1 : vec4f,
  @location(6) iRotation2 : vec4f,
  @location(7) iRotation3 : vec4f,
  @location(8) iColor : vec4f,
  @location(9) iMisc : vec4f,
  @location(10) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
  @location(3) @interpolate(flat) fog : f32,
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

  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z, v.iPosition.y + 0.5, 1.0);
  if (v.iShape.w > 0.5) {
    position += vec4f(v.aPosition.x * size, -height, v.aPosition.y * size, 0.0) * uRotationMat;
  } else {
    position += vec4f(v.aPosition.x * size, -height, v.aPosition.y * size, 0.0);
  }

  var clip = frame.projection * frame.model_view * position;
  clip.z -= v.iPosition.w;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.color = v.iColor;
  o.tex = v.iTex;
  o.fog = v.iMisc.x;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.color.a == 0.0) {
    discard;
  }
  if (i.tex.x < 0.0) {
    discard;
  }
  let textureSample = effect_texture(i.tex, i.uv);
  if (textureSample.a == 0.0) {
    discard;
  }
  if (textureSample.r < 0.01 && textureSample.g < 0.01 && textureSample.b < 0.01) {
    discard;
  }
  var fragColor = textureSample * i.color;
  if (i.fog > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
