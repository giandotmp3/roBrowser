// Ground tiles (families flat-texture, hovering-texture, lp, spider-web): legacy Tiles.vs/.fs,
// LPEffect.vs/.fs and SpiderWeb.vs/.fs, operation for operation (as gpu-webgl2 tile.vert/.frag).
// The per-draw uniforms became per-instance attributes (uPosition, uSize -> iPosition);
// iShade = (discard threshold, forced alpha, fog).

struct VertexIn {
  @location(0) aPosition : vec2f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iShade : vec4f,
  @location(4) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) shade : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z, v.iPosition.y + 0.5, 1.0);
  position += vec4f(v.aPosition.x * v.iPosition.w, 0.0, v.aPosition.y * v.iPosition.w, 0.0);
  var clip = frame.projection * frame.model_view * position;
  clip.z -= 0.01;
  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.shade = v.iShade;
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  var textureSample = effect_texture(i.tex, i.uv);
  if (textureSample.r < i.shade.x || textureSample.g < i.shade.x || textureSample.b < i.shade.x) {
    discard;
  }
  textureSample.a = i.shade.y;
  var fragColor = textureSample;
  if (i.shade.z > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
