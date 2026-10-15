// R-MAP-018/019/020 occluder fade: WGSL mirror of legacy Effects/Shaders/GLSL/OccluderFade.glsl
// (gpu-webgl2 shaders/occluderFade.glsl), operation for operation.
//
// u.occ_mode:
//   0 - disabled
//   1 - dither (screen-door, single opaque pass)
//   2 - alpha, opaque pass: discard fragments inside the fade capsule
//   3 - alpha, blend pass: draw only fragments inside the fade capsule, translucent
//   4 - line of sight query: keep only fragments inside the (narrow) capsule,
//       used with an occlusion query to detect geometry covering the entity

// The faded region is a cylinder of constant radius from the eye to the focus,
// cut by a vertical plane through the focus; it closes over this distance (cells) before it.
const OCCLUDER_FADE_END : f32 = 0.5;

// x: distance to the eye->focus axis,
// y: signed horizontal distance past the focus, along the view direction
fn occluder_fade_cylinder(world_pos : vec3f) -> vec2f {
  let axis = u.occ_focus - u.occ_eye;
  let rel = world_pos - u.occ_eye;
  let len = max(length(axis), 0.01);
  let t = clamp(dot(rel, axis) / (len * len), 0.0, 1.0);
  let level = vec3f(axis.x, 0.0, axis.z);
  let flatness = length(level) / len;
  let hdir = level / max(length(level), 0.01);
  let cut = normalize(mix(axis / len, hdir, smoothstep(0.3, 0.6, flatness)));
  return vec2f(length(rel - axis * t), dot(world_pos - u.occ_focus, cut));
}

// 0.0 = untouched, 1.0 = fully inside the cylinder between eye and focus
fn occluder_fade_amount(world_pos : vec3f) -> f32 {
  let c = occluder_fade_cylinder(world_pos);
  let radial = 1.0 - smoothstep(u.occ_radius * 0.5, u.occ_radius, c.x);
  let along = 1.0 - smoothstep(-OCCLUDER_FADE_END, 0.0, c.y);
  return radial * along * u.occ_strength;
}

// Applies the fade to the fragment alpha. Returns false when the fragment must be discarded.
// `frag_coord`: @builtin(position); the Bayer cell uses GL's bottom-left gl_FragCoord (with a
// y-flipped projection, u.flip_y, the framebuffer rows are GL's already).
fn occluder_fade(world_pos : vec3f, alpha : ptr<function, f32>, frag_coord : vec4f) -> bool {
  if (u.occ_mode == 0u) {
    return true;
  }

  if (u.occ_mode == 4u) {
    let c = occluder_fade_cylinder(world_pos);
    // stop short of the focus so the floor under the entity does not count
    return c.x < u.occ_radius && c.y < -0.5;
  }

  let fade = occluder_fade_amount(world_pos);
  let visibility = 1.0 - fade * (1.0 - u.occ_opacity);

  if (u.occ_mode == 1u) {
    var bayer = array<f32, 16>(
      0.0, 8.0, 2.0, 10.0,
      12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0,
      15.0, 7.0, 13.0, 5.0
    );
    let px = i32(frag_coord.x) & 3;
    let py = i32(select(u.target_height - frag_coord.y, frag_coord.y, u.flip_y > 0.5)) & 3;
    let threshold = (bayer[px + py * 4] + 0.5) / 16.0;
    return visibility > threshold;
  }

  if (u.occ_mode == 2u) {
    return fade < 0.01;
  }

  if (fade < 0.01) {
    return false;
  }
  *alpha = *alpha * visibility;
  return true;
}
