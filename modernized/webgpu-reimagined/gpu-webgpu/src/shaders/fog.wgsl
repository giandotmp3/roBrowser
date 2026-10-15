// R-MAP-004 shared fog include (ground, sprite, model, STR, effect shaders).
// f = smoothstep(near, far, fragCoord.z / fragCoord.w); rgb = mix(rgb, fogColor, f); alpha preserved.
struct Fog {
  color : vec3f,
  use_fog : u32,
  near : f32,
  far : f32,
};

fn apply_fog(c : vec4f, frag_coord : vec4f, fog : Fog) -> vec4f {
  if (fog.use_fog == 0u) {
    return c;
  }
  let depth = frag_coord.z / frag_coord.w;
  let f = smoothstep(fog.near, fog.far, depth);
  return vec4f(mix(c.rgb, fog.color, f), c.a);
}
