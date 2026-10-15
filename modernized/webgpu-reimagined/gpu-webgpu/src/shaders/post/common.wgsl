// Shared full-screen triangle and bindings for the post passes (C-11).
// Every pass binds: 0 linear clamp sampler, 1 input texture, 2 the pass uniforms (32 bytes), 3 a second
// texture (bloom composite only; other passes get the input again).
//
// Orientation: WebGPU uv.y runs top-down, legacy GL vUv.y bottom-up. The pass graph uploads every texel step
// with a negative y (postPasses.js `texel`), so an offset of +texel.y means "up the screen" exactly as in the
// legacy GLSL and every tap is the mirror image of the legacy tap: the shaders below are the legacy GLSL
// operation for operation. Taps use textureSampleLevel(…, 0) (the targets have one mip, as the legacy FBO
// textures) so they stay valid after the legacy early exits.
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct VsOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o : VsOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn tex(uv : vec2f) -> vec4f { return textureSampleLevel(src, samp, uv, 0.0); }
