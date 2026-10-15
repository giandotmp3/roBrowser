// C-08 sprite runs (instanced). R-SPR-006 z-index bias; R-SPR-005 depth correction (TODO);
// R-SPR-014 palette lookup with manual bilinear (TODO); R-SPR-017 colour; R-MAP-004 fog.
struct Frame {
  view : mat4x4f,
  proj : mat4x4f,
  zoom : f32, _p0 : f32, _p1 : f32, _p2 : f32,
  fog : Fog,
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var samp_nearest : sampler;
@group(0) @binding(2) var samp_linear : sampler;
@group(0) @binding(3) var pages : texture_2d_array<f32>;
@group(0) @binding(4) var palettes : texture_2d<f32>;

struct Instance {
  @location(1) position : vec3f,
  @location(2) offset_size : vec4f,
  @location(3) color : vec4f,
  @location(4) layer_palette_flags : vec4f,  // layer, palette row, flags, shadow factor
  @location(5) zindex_bias : vec2f,          // zIndex, depthBias
};

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f, @location(1) color : vec4f, @location(2) @interpolate(flat) lp : vec4f };

@vertex
fn vs_main(@location(0) corner : vec2f, inst : Instance) -> VsOut {
  // R-SPR-002 spherical billboard: drop the view rotation after translating.
  var mv = frame.view * mat4x4f(vec4f(1,0,0,0), vec4f(0,1,0,0), vec4f(0,0,1,0), vec4f(inst.position, 1.0));
  mv[0] = vec4f(1,0,0,0); mv[1] = vec4f(0,1,0,0); mv[2] = vec4f(0,0,1,0);
  let local = vec4f(corner * inst.offset_size.zw + inst.offset_size.xy, 0.0, 1.0);
  var clip = frame.proj * mv * local;
  // R-SPR-006
  clip.z -= (inst.zindex_bias.x * 0.01 + inst.zindex_bias.y) / max(frame.zoom, 1.0);
  var o : VsOut;
  o.pos = clip;
  o.uv = corner * 0.5 + 0.5;
  o.color = vec4f(inst.color.rgb * inst.layer_palette_flags.w, inst.color.a);
  o.lp = inst.layer_palette_flags;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let tex = textureSample(pages, samp_linear, i.uv, i32(i.lp.x));
  if (tex.a == 0.0) { discard; }
  return apply_fog(tex * i.color, i.pos, frame.fog);
}
