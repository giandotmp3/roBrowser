// C-08 sprite runs: instanced quad, one instance per SpriteDraw record (instance-step vertex buffer,
// layout in sprites/instanceLayout.js, 26 floats, byte-identical to gpu-webgl2). Reproduces legacy
// Renderer/SpriteRenderer.vs/.fs operation for operation (same as gpu-webgl2 sprite.vert/.frag):
// R-SPR-002 spherical billboard, R-SPR-005 depth correction (+ ignoreDepthMinCap, min cap),
// R-SPR-006 zIndex bias, R-SPR-014 manual 4-tap bilinear palette lookup (spec #64: index 255 clamps),
// R-SPR-012 shadow factor, R-SPR-016/017 RGBA frames and final colour, R-MAP-004 fog (shared include).
// Clip space stays GL-style ([-w, w] z) until the very end, where z is remapped to WebGPU's [0, w]:
// z' = (z + w) / 2 gives exactly GL's window depth (z/w + 1) / 2 with the default depth range.

struct Frame {
  model_view : mat4x4f,
  view_model : mat4x4f,   // inverse(model_view), computed on the CPU as legacy does
  projection : mat4x4f,
  zoom : f32,
  fog : Fog,
};

@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var samp_linear : sampler;
@group(0) @binding(2) var palettes : texture_2d<f32>;      // 256 x N rgba8unorm, textureLoad only
@group(0) @binding(3) var idx0 : texture_2d_array<f32>;    // r8unorm pools by POT class 32..512
@group(0) @binding(4) var idx1 : texture_2d_array<f32>;
@group(0) @binding(5) var idx2 : texture_2d_array<f32>;
@group(0) @binding(6) var idx3 : texture_2d_array<f32>;
@group(0) @binding(7) var idx4 : texture_2d_array<f32>;
@group(0) @binding(8) var rgba0 : texture_2d_array<f32>;   // rgba8unorm pools by POT class 32..512
@group(0) @binding(9) var rgba1 : texture_2d_array<f32>;
@group(0) @binding(10) var rgba2 : texture_2d_array<f32>;
@group(0) @binding(11) var rgba3 : texture_2d_array<f32>;
@group(0) @binding(12) var rgba4 : texture_2d_array<f32>;

struct Instance {
  @location(2) position : vec3f,
  @location(3) offset : vec2f,        // world units, legacy _offset (y already - 0.5)
  @location(4) size : vec2f,          // world units, signed (mirror = negative width)
  @location(5) rotation : vec2f,      // (cos, sin) of -angle, as legacy mat4.rotateZ
  @location(6) color : vec4f,
  @location(7) shadow : f32,
  @location(8) zindex_bias : vec2f,   // x: zIndex, y: depthBias
  @location(9) depth_flags : vec2f,   // x: depthCorrection, y: ignoreDepthMinCap
  @location(10) layer : vec4f,        // x: array layer, y: palette row, z: POT class, w: sampler (1 linear)
  @location(11) frame_size : vec4f,   // xy: frame size (px), zw: palette bilinear size (legacy uTextSize)
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) shadow : f32,
  @location(3) @interpolate(flat) layer : vec4f,
  @location(4) @interpolate(flat) frame_size : vec4f,
};

// R-SPR-002: translate to the sprite (x, -z, y) + half a cell, then drop the view rotation.
fn project(m_in : mat4x4f, pos : vec3f) -> mat4x4f {
  var m = m_in;
  let x = pos.x + 0.5;
  let y = -pos.z;
  let z = pos.y + 0.5;

  m[3].x += m[0].x * x + m[1].x * y + m[2].x * z;
  m[3].y += m[0].y * x + m[1].y * y + m[2].y * z;
  m[3].z += (m[0].z * x + m[1].z * y + m[2].z * z);
  m[3].w += m[0].w * x + m[1].w * y + m[2].w * z;

  m[0] = vec4f(1.0, 0.0, 0.0, m[0].w);
  m[1] = vec4f(0.0, 1.0, 0.0, m[1].w);
  m[2] = vec4f(0.0, 0.0, 1.0, m[2].w);

  return m;
}

@vertex
fn vs_main(@location(0) corner : vec2f, @location(1) tex_coord : vec2f, inst : Instance) -> VsOut {
  let angle = mat4x4f(
    inst.rotation.x, inst.rotation.y, 0.0, 0.0,
    -inst.rotation.y, inst.rotation.x, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0
  );
  var position = angle * vec4f(corner.x * inst.size.x, corner.y * inst.size.y, 0.0, 1.0);
  position.x += inst.offset.x;
  position.y -= inst.offset.y + 0.5;

  let model_view = project(frame.model_view, inst.position);
  let view_position = model_view * position;
  let view_center = model_view * vec4f(0.0, 0.0, 0.0, 1.0);

  var clip = frame.projection * view_position;

  // R-SPR-005: the vertex takes the depth where its camera ray meets the vertical
  // plane through the sprite centre (normal = flattened camera forward), capped with
  // min(original, corrected) unless ignoreDepthMinCap (NPCs).
  if (inst.depth_flags.x > 0.5) {
    let camera_pos = (frame.view_model * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    let camera_forward = normalize((frame.view_model * vec4f(0.0, 0.0, -1.0, 0.0)).xyz);
    let plane_point = (frame.view_model * view_center).xyz;
    var plane_normal = normalize(vec3f(camera_forward.x, 0.0, camera_forward.z));
    if (length(plane_normal) < 0.000001) {
      plane_normal = camera_forward;
    }

    let world_vertex = (frame.view_model * view_position).xyz;
    let ray_dir = normalize(world_vertex - camera_pos);
    let denom = max(dot(plane_normal, ray_dir), 0.000001);
    let dist = dot(plane_point - camera_pos, plane_normal) / denom;

    let plane_clip = frame.projection * (frame.model_view * vec4f(camera_pos + ray_dir * dist, 1.0));
    let corrected_z_base = plane_clip.z * (clip.w / max(plane_clip.w, 0.000001));

    clip.z = select(min(clip.z, corrected_z_base), corrected_z_base, inst.depth_flags.y > 0.5);
  }

  // R-SPR-006: later layers win ties.
  clip.z -= (inst.zindex_bias.x * 0.01 + inst.zindex_bias.y) / max(frame.zoom, 1.0);

  // GL clip z [-w, w] -> WebGPU [0, w] (same window depth as legacy).
  clip.z = (clip.z + clip.w) * 0.5;

  var o : VsOut;
  o.pos = clip;
  o.uv = tex_coord;
  o.color = inst.color;
  o.shadow = inst.shadow;
  o.layer = inst.layer;
  o.frame_size = inst.frame_size;
  return o;
}

fn fetch_index(cls : i32, p : vec2i, layer : i32) -> f32 {
  switch cls {
    case 0: { return textureLoad(idx0, p, layer, 0).r; }
    case 1: { return textureLoad(idx1, p, layer, 0).r; }
    case 2: { return textureLoad(idx2, p, layer, 0).r; }
    case 3: { return textureLoad(idx3, p, layer, 0).r; }
    default: { return textureLoad(idx4, p, layer, 0).r; }
  }
}

fn fetch_rgba(cls : i32, p : vec2i, layer : i32) -> vec4f {
  switch cls {
    case 0: { return textureLoad(rgba0, p, layer, 0); }
    case 1: { return textureLoad(rgba1, p, layer, 0); }
    case 2: { return textureLoad(rgba2, p, layer, 0); }
    case 3: { return textureLoad(rgba3, p, layer, 0); }
    default: { return textureLoad(rgba4, p, layer, 0); }
  }
}

fn filter_rgba(cls : i32, uv : vec2f, layer : i32) -> vec4f {
  switch cls {
    case 0: { return textureSampleLevel(rgba0, samp_linear, uv, layer, 0.0); }
    case 1: { return textureSampleLevel(rgba1, samp_linear, uv, layer, 0.0); }
    case 2: { return textureSampleLevel(rgba2, samp_linear, uv, layer, 0.0); }
    case 3: { return textureSampleLevel(rgba3, samp_linear, uv, layer, 0.0); }
    default: { return textureSampleLevel(rgba4, samp_linear, uv, layer, 0.0); }
  }
}

// Legacy texture(frame, uv) on a NEAREST, CLAMP_TO_EDGE frame texture: the frame sits
// in the top-left frameSize corner of its array layer.
fn nearest_texel(uv : vec2f, frame_size : vec2f) -> vec2i {
  return clamp(vec2i(floor(uv * frame_size)), vec2i(0), vec2i(frame_size) - 1);
}

// Legacy texture(LUT, vec2(i, 1.0)): 256 wide, NEAREST. Legacy's default REPEAT wrap
// sends index 255 (normalised 1.0) to column 0; the rebuild clamps so it shows entry
// 255 (spec #64, HITL delegated policy).
fn palette_at(i : f32, row : i32) -> vec4f {
  let column = min(i32(floor(i * 256.0)), 255);
  return vec4f(textureLoad(palettes, vec2i(column, row), 0).rgb, 1.0);
}

// Legacy bilinearSample: four NEAREST index taps 1/uTextSize apart, index 0 is
// transparent, palette colours blended with f = fract(uv * uTextSize).
fn sample_indexed(i : VsOut) -> vec4f {
  let cls = i32(i.layer.z);
  let layer = i32(i.layer.x);
  let row = i32(i.layer.y);
  let interval = 1.0 / i.frame_size.zw;
  let i00 = fetch_index(cls, nearest_texel(i.uv, i.frame_size.xy), layer);
  let i10 = fetch_index(cls, nearest_texel(i.uv + vec2f(interval.x, 0.0), i.frame_size.xy), layer);
  let i01 = fetch_index(cls, nearest_texel(i.uv + vec2f(0.0, interval.y), i.frame_size.xy), layer);
  let i11 = fetch_index(cls, nearest_texel(i.uv + interval, i.frame_size.xy), layer);
  let c00 = select(palette_at(i00, row), vec4f(0.0), i00 == 0.0);
  let c10 = select(palette_at(i10, row), vec4f(0.0), i10 == 0.0);
  let c01 = select(palette_at(i01, row), vec4f(0.0), i01 == 0.0);
  let c11 = select(palette_at(i11, row), vec4f(0.0), i11 == 0.0);
  let f = fract(i.uv * i.frame_size.zw);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

fn sample_rgba(i : VsOut) -> vec4f {
  let cls = i32(i.layer.z);
  let layer = i32(i.layer.x);
  if (i.layer.w < 0.5) {
    return fetch_rgba(cls, nearest_texel(i.uv, i.frame_size.xy), layer);
  }
  let class_size = f32(32 << u32(cls));
  return filter_rgba(cls, i.uv * (i.frame_size.xy / class_size), layer);
}

fn finish(i : VsOut, sampled : vec4f) -> vec4f {
  if (sampled.a == 0.0) {
    discard;
  }
  // R-SPR-012 then R-SPR-017: rgb *= shadow, then tex * colour (legacy order).
  let shaded = vec4f(sampled.rgb * i.shadow, sampled.a);
  return apply_fog(shaded * i.color, i.pos, frame.fog);
}

// Runs never mix texture classes, so the class is a pipeline (entry point), not a uniform.
@fragment
fn fs_indexed(i : VsOut) -> @location(0) vec4f {
  // Not resident (residency miss) or fully transparent colour: nothing to draw.
  if (i.layer.x < 0.0 || i.color.a == 0.0) {
    discard;
  }
  return finish(i, sample_indexed(i));
}

@fragment
fn fs_rgba(i : VsOut) -> @location(0) vec4f {
  if (i.layer.x < 0.0 || i.color.a == 0.0) {
    discard;
  }
  return finish(i, sample_rgba(i));
}
