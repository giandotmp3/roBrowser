// lock-on: legacy LockOnTarget.vs/.fs (as gpu-webgl2 lockOn.vert/.frag; green and blue scaled by
// the shade). iPosition = (uPosition, uSize), iRotation0..3 = uRotationMat columns, iMisc =
// (uColor shade, fog).

struct VertexIn {
  @location(0) aPosition : vec2f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iRotation0 : vec4f,
  @location(4) iRotation1 : vec4f,
  @location(5) iRotation2 : vec4f,
  @location(6) iRotation3 : vec4f,
  @location(7) iMisc : vec4f,
  @location(8) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) misc : vec2f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uRotationMat = mat4x4f(v.iRotation0, v.iRotation1, v.iRotation2, v.iRotation3);
  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z, v.iPosition.y + 0.5, 1.0);
  position += vec4f(v.aPosition.x * v.iPosition.w, 0.0, v.aPosition.y * v.iPosition.w, 0.0) * uRotationMat;

  var clip = frame.projection * frame.model_view * position;
  clip.z -= 0.02;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.misc = v.iMisc.xy;
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
  var fragColor = textureSample;
  fragColor = vec4f(fragColor.r, fragColor.g * i.misc.x, fragColor.b * i.misc.x, fragColor.a);
  if (i.misc.y > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
