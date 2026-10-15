// level99Bubble: legacy Level99Bubble.vs/.fs over the billboard quad of the record (per-record
// vertex data; as gpu-webgl2 level99Bubble.vert/.frag; uSolidBg is the debug spawn volume, never
// on in a record). iMisc = (uZIndex, fog).

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iColor : vec4f,
  @location(3) iMisc : vec4f,
  @location(4) iTex : vec4f,
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
  var clip = frame.projection * frame.model_view * vec4f(v.aPosition, 1.0);
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
  var textureSample = effect_texture(i.tex, i.uv);
  textureSample *= i.color;
  var fragColor = textureSample;
  if (i.fog > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
