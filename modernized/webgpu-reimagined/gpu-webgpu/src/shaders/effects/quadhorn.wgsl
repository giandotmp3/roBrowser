// quadhorn: legacy QuadHorn.vs/.fs (as gpu-webgl2 quadhorn.vert/.frag). iPosition = (uPosition,
// uHeight), iOffset = (uOffsetX, uOffsetY, uOffsetZ, uBottomSize); iRotX/Y/Z = the 3x3 blocks of
// the three rotation matrices, built on the CPU exactly as legacy gl-matrix builds them
// (column-major; the fourth row and column are the identity's). iMisc.x = fog.

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iOffset : vec4f,
  @location(4) iRotX0 : vec3f,
  @location(5) iRotX1 : vec3f,
  @location(6) iRotX2 : vec3f,
  @location(7) iRotY0 : vec3f,
  @location(8) iRotY1 : vec3f,
  @location(9) iRotY2 : vec3f,
  @location(10) iRotZ0 : vec3f,
  @location(11) iRotZ1 : vec3f,
  @location(12) iRotZ2 : vec3f,
  @location(13) iColor : vec4f,
  @location(14) iMisc : vec4f,
  @location(15) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
  @location(3) @interpolate(flat) fog : f32,
};

fn rotation(c0 : vec3f, c1 : vec3f, c2 : vec3f) -> mat4x4f {
  return mat4x4f(vec4f(c0, 0.0), vec4f(c1, 0.0), vec4f(c2, 0.0), vec4f(0.0, 0.0, 0.0, 1.0));
}

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uXRotationMat = rotation(v.iRotX0, v.iRotX1, v.iRotX2);
  let uYRotationMat = rotation(v.iRotY0, v.iRotY1, v.iRotY2);
  let uZRotationMat = rotation(v.iRotZ0, v.iRotZ1, v.iRotZ2);
  let uHeight = v.iPosition.w;
  var position = vec4f(v.iPosition.x + v.iOffset.x, -v.iPosition.z - ((uHeight * 0.9) + v.iOffset.z), v.iPosition.y + v.iOffset.y, 1.0);
  position += vec4f(v.aPosition.x * v.iOffset.w, v.aPosition.y * uHeight, v.aPosition.z * v.iOffset.w, 0.0) * uXRotationMat * uYRotationMat * uZRotationMat;
  let clip = frame.projection * frame.model_view * position;

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
