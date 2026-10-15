// swirlingAura: legacy SwirlingAura.vs/.fs over the band mesh of the record (per-record vertex
// data, de-indexed in index order; as gpu-webgl2 swirlingAura.vert/.frag). uModelMat is the
// identity translated by the record position (legacy mat4.translate on the identity); iMisc =
// (uZIndex, fog).

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iTranslation : vec4f,
  @location(3) iColor : vec4f,
  @location(4) iMisc : vec4f,
  @location(5) iTex : vec4f,
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
  let uModelMat = mat4x4f(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    v.iTranslation.x, v.iTranslation.y, v.iTranslation.z, 1.0
  );
  let worldPos = uModelMat * vec4f(v.aPosition, 1.0);
  var clip = frame.projection * frame.model_view * worldPos;
  clip.z -= v.iMisc.x;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.color = v.iColor;
  o.tex = v.iTex;
  o.fog = v.iMisc.y;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  let texColor = effect_texture(i.tex, i.uv);
  if (texColor.a < 0.01) {
    discard;
  }
  // Discard near-black pixels.
  if (texColor.r < 0.01 && texColor.g < 0.01 && texColor.b < 0.01) {
    discard;
  }
  var fragColor = texColor * i.color;
  if (i.fog > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
