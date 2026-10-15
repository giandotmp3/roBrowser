// C-03 ground: R-MAP-001/002/003 shading, R-MAP-004 fog, R-MAP-007 tile colour. Same
// arithmetic, in the same order, as legacy Map/Ground.vs / Ground.fs (gpu-webgl2
// shaders/world/ground.vert + shaders/ground.frag): the light weighting comes from the
// vertex stage. Every texture is sampled up front (uniform control flow).
@group(0) @binding(2) var diffuse_tex : texture_2d<f32>;
@group(0) @binding(3) var lightmap_tex : texture_2d<f32>;
@group(0) @binding(4) var tile_color_tex : texture_2d<f32>;

struct GroundOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) lightmap_uv : vec2f,
  @location(2) tile_color_uv : vec2f,
  @location(3) light_weighting : f32,
};

@vertex
fn vs_main(@location(0) position : vec3f, @location(1) normal : vec3f, @location(2) uv : vec2f,
           @location(3) lightmap_uv : vec2f, @location(4) tile_color_uv : vec2f) -> GroundOut {
  var o : GroundOut;
  o.pos = gl_clip(u.projection * u.model_view * vec4f(position, 1.0));
  o.uv = uv;
  o.lightmap_uv = lightmap_uv;
  o.tile_color_uv = tile_color_uv;
  let dot_product = dot(normal, u.light_dir);
  o.light_weighting = max(dot_product, 0.0);
  return o;
}

fn posterize(c : vec3f) -> vec3f {
  var p = c * 255.0;
  p = floor(p / 16.0) * 16.0;
  p = p / 255.0;
  return p;
}

@fragment
fn fs_main(i : GroundOut) -> @location(0) vec4f {
  var tex = textureSample(diffuse_tex, samp, i.uv);
  let tile_color = textureSample(tile_color_tex, samp, i.tile_color_uv);
  var lightmap = textureSample(lightmap_tex, samp, i.lightmap_uv);
  if (tex.a < 0.1) {
    discard;
  }

  // Tile colour (R-MAP-007): rgba, alpha included, where the cell has a top tile.
  if (any(i.tile_color_uv != vec2f(0.0, 0.0))) {
    tex *= tile_color;
  }

  let color = i.light_weighting * u.light_diffuse + u.light_ambient;
  tex = vec4f(tex.rgb * clamp(color, vec3f(0.0), vec3f(1.0)), tex.a);
  tex = vec4f(tex.rgb * clamp(u.light_env, vec3f(0.0), vec3f(1.0)), tex.a);

  if (u.lightmap_use != 0u) {
    if (u.smooth_light == 0u) {
      lightmap = vec4f(posterize(lightmap.rgb), lightmap.a);
    } else if (u.smooth_light == 2u) {
      lightmap = vec4f(pow(lightmap.rgb, vec3f(1.1)), lightmap.a);
    }
    tex = vec4f(tex.rgb * lightmap.a, tex.a);
    tex = vec4f(tex.rgb + clamp(lightmap.rgb, vec3f(0.0), vec3f(1.0)), tex.a);
  }

  return apply_fog(tex, i.pos, u.fog);
}
