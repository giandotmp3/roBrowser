// magic-target: legacy MagicTarget.vs/.fs over the ground plane of the record (per-record vertex
// data; as gpu-webgl2 magicTarget.vert/.frag). iRotation0..3 = uRotationMat columns, iMisc =
// (uCameraLatitude, fog).

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iRotation0 : vec4f,
  @location(3) iRotation1 : vec4f,
  @location(4) iRotation2 : vec4f,
  @location(5) iRotation3 : vec4f,
  @location(6) iMisc : vec4f,
  @location(7) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) fog : f32,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uRotationMat = mat4x4f(v.iRotation0, v.iRotation1, v.iRotation2, v.iRotation3);
  var clip = frame.projection * frame.model_view * vec4f(v.aPosition, 1.0);
  clip.z -= 0.02 / v.iMisc.x;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = (uRotationMat * vec4f(v.aTextureCoord - 0.5, 1.0, 1.0)).xy + 0.5;
  o.fog = v.iMisc.y;
  o.tex = v.iTex;
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
  if (textureSample.r < 0.1 || textureSample.g < 0.1 || textureSample.b < 0.1) {
    discard;
  }
  var fragColor = textureSample;
  if (i.fog > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
