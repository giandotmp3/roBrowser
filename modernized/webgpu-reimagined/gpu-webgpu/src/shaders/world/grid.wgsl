// R-MAP-021 grid selector (legacy Map/GridSelector.vs/.fs): lowered by 0.1 (RO's inverted Y);
// R-MAP-004 fog.
@group(0) @binding(2) var grid_tex : texture_2d<f32>;

struct GridOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(@location(0) position : vec3f, @location(1) uv : vec2f) -> GridOut {
  var p = position;
  p.y -= 0.1;
  var o : GridOut;
  o.pos = gl_clip(u.projection * u.model_view * vec4f(p, 1.0));
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(i : GridOut) -> @location(0) vec4f {
  let texture_sample = textureSample(grid_tex, samp, i.uv);
  if (texture_sample.a == 0.0) {
    discard;
  }
  return apply_fog(texture_sample, i.pos, u.fog);
}
