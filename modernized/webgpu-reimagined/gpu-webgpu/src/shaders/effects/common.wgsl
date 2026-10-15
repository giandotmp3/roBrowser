// Mesh effect families (effects/mesh/): shared header prepended to every mesh program
// (programs.js meshShaderSource). Group 0 = the pass block, the wrap's sampler and the
// five rgba8 texture-array pools of the residency (same pools as sprites and STR).
//
// Like sprite.wgsl and str.wgsl, clip space stays GL-style ([-w, w] z) through every
// legacy operation (including the per-family clip-z biases), and only the final
// position is remapped to WebGPU's [0, w] with z' = (z + w) / 2, which gives exactly
// GL's window depth with the default depth range. Clip y is up in both APIs and texel
// row 0 is the image's top row on both sides, so nothing is flipped.

struct MeshFrame {
  model_view : mat4x4f,     // legacy uModelViewMat
  projection : mat4x4f,     // legacy uProjectionMat
  normal : mat3x3f,         // RSM uNormalMat (toInverseMat3 + transpose of model_view)
  light_dir : vec3f,        // RSM uLightDirection
  light_opacity : f32,      // RSM uLightOpacity
  light_ambient : vec3f,    // RSM uLightAmbient
  light_diffuse : vec3f,    // RSM uLightDiffuse
  fog_color : vec3f,        // uFogColor
  fog_near : f32,           // uFogNear
  fog_far : f32,            // uFogFar
};

@group(0) @binding(0) var<uniform> frame : MeshFrame;
@group(0) @binding(1) var samp : sampler;                  // LINEAR; clamp, repeat or repeat-u (the run's wrap)
@group(0) @binding(2) var rgba0 : texture_2d_array<f32>;   // rgba8unorm pools by POT class 32..512
@group(0) @binding(3) var rgba1 : texture_2d_array<f32>;
@group(0) @binding(4) var rgba2 : texture_2d_array<f32>;
@group(0) @binding(5) var rgba3 : texture_2d_array<f32>;
@group(0) @binding(6) var rgba4 : texture_2d_array<f32>;

// GL clip z [-w, w] -> WebGPU [0, w] (same window depth as legacy).
fn gl_to_webgpu(clip : vec4f) -> vec4f {
  return vec4f(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

// The effect texture is an rgba8 texture-array layer (residency). The image sits in the
// layer's top-left corner, edge-replicated, so LINEAR over uv * (size / class) equals
// legacy's per-texture LINEAR + CLAMP_TO_EDGE; a family whose legacy texture wraps
// (REPEAT) draws its run with a repeat sampler, exact when the image fills its layer.
// tex: x array layer (-1: not resident), y POT class index, zw image size / class size.
fn effect_texture(tex : vec4f, uv : vec2f) -> vec4f {
  let p = uv * tex.zw;
  let layer = i32(tex.x);
  switch i32(tex.y) {
    case 0: { return textureSampleLevel(rgba0, samp, p, layer, 0.0); }
    case 1: { return textureSampleLevel(rgba1, samp, p, layer, 0.0); }
    case 2: { return textureSampleLevel(rgba2, samp, p, layer, 0.0); }
    case 3: { return textureSampleLevel(rgba3, samp, p, layer, 0.0); }
    default: { return textureSampleLevel(rgba4, samp, p, layer, 0.0); }
  }
}

// Legacy effect fog, as each legacy .fs writes it (the record decides, not frame.use):
// depth = gl_FragCoord.z / gl_FragCoord.w; mix(color, vec4(uFogColor, color.a), f).
fn effect_fog(c : vec4f, frag_coord : vec4f) -> vec4f {
  let depth = frag_coord.z / frag_coord.w;
  let fog_factor = smoothstep(frame.fog_near, frame.fog_far, depth);
  return mix(c, vec4f(frame.fog_color, c.w), fog_factor);
}

fn effect_fog_factor(frag_coord : vec4f) -> f32 {
  return smoothstep(frame.fog_near, frame.fog_far, frag_coord.z / frag_coord.w);
}
