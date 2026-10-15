// R-PP-006 FXAA. FIX: `subpix` is read (legacy uploaded fxaaSubpix but never used it).
struct Fxaa { texel : vec2f, edge_threshold : f32, edge_threshold_min : f32, span : f32, reduce_mul : f32, reduce_min : f32, subpix : f32 };
@group(0) @binding(2) var<uniform> u : Fxaa;

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  let c = textureSample(src, samp, i.uv).rgb;
  let nw = luma(textureSample(src, samp, i.uv + vec2f(-1.0, -1.0) * u.texel).rgb);
  let ne = luma(textureSample(src, samp, i.uv + vec2f(1.0, -1.0) * u.texel).rgb);
  let sw = luma(textureSample(src, samp, i.uv + vec2f(-1.0, 1.0) * u.texel).rgb);
  let se = luma(textureSample(src, samp, i.uv + vec2f(1.0, 1.0) * u.texel).rgb);
  let m = luma(c);
  let lmin = min(m, min(min(nw, ne), min(sw, se)));
  let lmax = max(m, max(max(nw, ne), max(sw, se)));
  if (lmax - lmin < max(u.edge_threshold_min, lmax * u.edge_threshold)) { return vec4f(c, 1.0); }
  var dir = vec2f(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let reduce = max((nw + ne + sw + se) * 0.25 * u.reduce_mul, u.reduce_min);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2f(-u.span), vec2f(u.span)) * u.texel;
  let a = 0.5 * (textureSample(src, samp, i.uv - dir / 6.0).rgb + textureSample(src, samp, i.uv + dir / 6.0).rgb);
  // Sub-pixel blend weight: subpix 0 keeps the legacy result (full edge filter);
  // subpix 1 weights the filter by local sub-pixel contrast. Exact curve needs SME sign-off.
  let local_avg = (nw + ne + sw + se) * 0.25;
  let contrast = clamp(abs(local_avg - m) / (lmax - lmin), 0.0, 1.0);
  let blend = mix(1.0, contrast, u.subpix);
  return vec4f(mix(c, a, blend), 1.0);
}
