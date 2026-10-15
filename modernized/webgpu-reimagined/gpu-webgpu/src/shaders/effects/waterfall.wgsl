// waterfall (curtain segment): legacy WaterfallEffect.vs/.fs (as gpu-webgl2 waterfall.vert/.frag).
// One instance per record, a 4-vertex strip whose corners come from the record vertices
// (iCornerX/Y/Z/U/V hold corner k in component k; vertex_index picks it); iModel0..3 = uModelMat
// columns, iMisc = (uOpacity, fog).

struct VertexIn {
  @location(0) iCornerX : vec4f,
  @location(1) iCornerY : vec4f,
  @location(2) iCornerZ : vec4f,
  @location(3) iCornerU : vec4f,
  @location(4) iCornerV : vec4f,
  @location(5) iModel0 : vec4f,
  @location(6) iModel1 : vec4f,
  @location(7) iModel2 : vec4f,
  @location(8) iModel3 : vec4f,
  @location(9) iMisc : vec4f,
  @location(10) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) misc : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(@builtin(vertex_index) k : u32, v : VertexIn) -> VsOut {
  let uModelMat = mat4x4f(v.iModel0, v.iModel1, v.iModel2, v.iModel3);
  var cx = v.iCornerX;
  var cy = v.iCornerY;
  var cz = v.iCornerZ;
  var cu = v.iCornerU;
  var cv = v.iCornerV;
  let aPosition = vec3f(cx[k], cy[k], cz[k]);
  let aTextureCoord = vec2f(cu[k], cv[k]);
  let worldPosition = uModelMat * vec4f(aPosition.x, -aPosition.y, aPosition.z, 1.0);
  let clip = frame.projection * frame.model_view * worldPosition;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = aTextureCoord;
  o.misc = v.iMisc;
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  var fragColor = effect_texture(i.tex, i.uv);
  fragColor.a *= i.misc.x;
  if (fragColor.a < 0.01) {
    discard;
  }
  if (i.misc.y > 0.5) {
    let fogFactor = effect_fog_factor(i.pos);
    fragColor = mix(fragColor, vec4f(frame.fog_color, fragColor.a), fogFactor);
  }
  return fragColor;
}
