// R-PP-006 FXAA (HITL round 2). Mirrors the CPU reference src/post/fxaa.js line for line.
// Edge path: legacy Shaders/GLSL/FXAA.fs (Rec.601 luma, threshold, span 8, reduce 1/32 and 1/128).
// fxaaSubpix drives the standard FXAA 3.11 (quality) subpixel aliasing removal term; 0 = off (legacy result).
// textureSampleLevel keeps every tap valid after the non-uniform early exit.
struct Fxaa { texel : vec2f, edge_threshold : f32, edge_threshold_min : f32, span : f32, reduce_mul : f32, reduce_min : f32, subpix : f32 };
@group(0) @binding(2) var<uniform> u : Fxaa;

fn fxaa_luma(c : vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

fn tap(uv : vec2f, off : vec2f) -> vec3f { return textureSampleLevel(src, samp, uv + off * u.texel, 0.0).rgb; }

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let rgb_m = tap(i.uv, vec2f(0.0, 0.0));
  let m = fxaa_luma(rgb_m);
  let nw = fxaa_luma(tap(i.uv, vec2f(-1.0, -1.0)));
  let ne = fxaa_luma(tap(i.uv, vec2f(1.0, -1.0)));
  let sw = fxaa_luma(tap(i.uv, vec2f(-1.0, 1.0)));
  let se = fxaa_luma(tap(i.uv, vec2f(1.0, 1.0)));
  let luma_min = min(m, min(min(nw, ne), min(sw, se)));
  let luma_max = max(m, max(max(nw, ne), max(sw, se)));
  if (luma_max - luma_min < max(u.edge_threshold_min, luma_max * u.edge_threshold)) { return vec4f(rgb_m, 1.0); }

  // Legacy edge path (FXAA.fs).
  var dir = vec2f(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let dir_reduce = max((nw + ne + sw + se) * u.reduce_mul, u.reduce_min);
  let rcp_dir_min = 1.0 / (min(abs(dir.x), abs(dir.y)) + dir_reduce);
  dir = clamp(dir * rcp_dir_min, vec2f(-u.span), vec2f(u.span));
  let rgb_a = 0.5 * (tap(i.uv, dir * (1.0 / 3.0 - 0.5)) + tap(i.uv, dir * (2.0 / 3.0 - 0.5)));
  let rgb_b = rgb_a * 0.5 + 0.25 * (tap(i.uv, dir * -0.5) + tap(i.uv, dir * 0.5));
  let luma_b = fxaa_luma(rgb_b);
  let rgb_edge = select(rgb_b, rgb_a, luma_b < luma_min || luma_b > luma_max);

  // FXAA 3.11 subpixel aliasing removal.
  let n = fxaa_luma(tap(i.uv, vec2f(0.0, -1.0)));
  let s = fxaa_luma(tap(i.uv, vec2f(0.0, 1.0)));
  let w = fxaa_luma(tap(i.uv, vec2f(-1.0, 0.0)));
  let e = fxaa_luma(tap(i.uv, vec2f(1.0, 0.0)));
  let range = max(max(m, max(n, s)), max(w, e)) - min(min(m, min(n, s)), min(w, e));
  let subpix_a = (n + s + w + e) * 2.0 + (nw + sw + ne + se);
  let subpix_b = subpix_a * (1.0 / 12.0) - m;
  let subpix_c = select(0.0, saturate(abs(subpix_b) / max(range, 1e-30)), range > 0.0);
  let subpix_d = -2.0 * subpix_c + 3.0;
  let subpix_e = subpix_c * subpix_c;
  let subpix_f = subpix_d * subpix_e;
  let subpix_g = subpix_f * subpix_f;
  let subpix_h = subpix_g * u.subpix;

  // FXAA 3.11 edge orientation: the steeper neighbour across the edge.
  let edge_horz = abs(-2.0 * w + (nw + sw)) + abs(-2.0 * m + (n + s)) * 2.0 + abs(-2.0 * e + (ne + se));
  let edge_vert = abs(-2.0 * s + (sw + se)) + abs(-2.0 * m + (w + e)) * 2.0 + abs(-2.0 * n + (nw + ne));
  let horz_span = edge_horz >= edge_vert;
  let luma_n = select(w, n, horz_span);
  let luma_s = select(e, s, horz_span);
  let length_sign = select(1.0, -1.0, abs(luma_n - m) >= abs(luma_s - m));
  let across = select(vec2f(length_sign, 0.0), vec2f(0.0, length_sign), horz_span);
  let rgb_across = tap(i.uv, across);
  let to_across = fxaa_luma(rgb_across) - m;
  let edge_blend = select(1.0, saturate((fxaa_luma(rgb_edge) - m) / select(1.0, to_across, to_across != 0.0)), to_across != 0.0);

  // Final blend = max(edge blend, subpixH): the legacy edge result unless subpix moves further.
  if (max(edge_blend, subpix_h) == edge_blend) { return vec4f(rgb_edge, 1.0); }
  return vec4f(mix(rgb_m, rgb_across, subpix_h), 1.0);
}
