// rsm: legacy RsmEffect.vs/.fs over the object's vertices of the record (per-record vertex data:
// position, normal, uv, alpha; as gpu-webgl2 rsm.vert/.frag). iPosition = (uPosition, uSize),
// iMisc.x = fog. frame.normal is the pass normal matrix (legacy mat4.toInverseMat3 +
// mat3.transpose of the model-view); the light is the family's constant light (legacy
// RsmEffect.js `_light`: ambient pi, diffuse 0, opacity 1), uploaded per pass.

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aVertexNormal : vec3f,
  @location(2) aTextureCoord : vec2f,
  @location(3) aAlpha : f32,
  @location(4) iPosition : vec4f,
  @location(5) iMisc : vec4f,
  @location(6) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) lightWeighting : f32,
  @location(2) alpha : f32,
  @location(3) @interpolate(flat) tex : vec4f,
  @location(4) @interpolate(flat) fog : f32,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  var position = vec4f(v.iPosition.x + 0.5, -v.iPosition.z, v.iPosition.y + 0.5, 1.0);
  position += vec4f(v.aPosition.x * v.iPosition.w, v.aPosition.y * -v.iPosition.w, v.aPosition.z * v.iPosition.w, 0.0);

  let clip = frame.projection * frame.model_view * position;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.alpha = v.aAlpha;

  let lDirection = frame.model_view * vec4f(frame.light_dir, 0.0);
  let dirVector = normalize(lDirection.xyz);
  let dotProduct = dot(frame.normal * v.aVertexNormal, dirVector);
  o.lightWeighting = max(dotProduct, 0.5);
  o.tex = v.iTex;
  o.fog = v.iMisc.x;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  let textureSample = effect_texture(i.tex, i.uv);
  if (textureSample.a == 0.0) {
    discard;
  }
  let Ambient = frame.light_ambient * frame.light_opacity;
  let Diffuse = frame.light_diffuse * i.lightWeighting;
  let LightColor = vec4f(Ambient + Diffuse, 1.0);

  var fragColor = textureSample * clamp(LightColor, vec4f(0.0), vec4f(1.0));
  fragColor.a *= i.alpha;
  if (i.fog > 0.5) {
    fragColor = effect_fog(fragColor, i.pos);
  }
  return fragColor;
}
