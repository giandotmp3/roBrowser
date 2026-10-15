// groundAura: legacy GroundAura.vs/.fs (as gpu-webgl2 groundAura.vert/.frag; no fog: legacy
// uploads the fog uniforms, the shader declares none). iPosition = uWorldPosition, iShape =
// (uSize, uAngle, uZIndex).

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iShape : vec4f,
  @location(4) iColor : vec4f,
  @location(5) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) color : vec4f,
  @location(2) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uWorldPosition = v.iPosition.xyz;
  let uSize = v.iShape.xy;
  let uAngle = v.iShape.z;

  // Size from SpriteRenderer units to world units: size / 175 * 5 = size / 35.
  let sizeX = uSize.x / 35.0;
  let sizeY = uSize.y / 35.0;

  let pos = vec3f(v.aPosition.x * sizeX, v.aPosition.y, v.aPosition.z * sizeY);

  // Rotate around the Y axis.
  let cosA = cos(uAngle);
  let sinA = sin(uAngle);
  let rotatedPos = vec3f(pos.x * cosA - pos.z * sinA, pos.y, pos.x * sinA + pos.z * cosA);

  // RO coordinate system: x, -z (height), y.
  let worldPos = vec3f(
    uWorldPosition.x + 0.5 + rotatedPos.x,
    -uWorldPosition.z + rotatedPos.y,
    uWorldPosition.y + 0.5 + rotatedPos.z
  );

  var clip = frame.projection * frame.model_view * vec4f(worldPos, 1.0);
  clip.z -= v.iShape.w * 0.01;

  var o : VsOut;
  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.color = v.iColor;
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  let texColor = effect_texture(i.tex, i.uv);
  if (texColor.a < 0.01) {
    discard;
  }
  return texColor * i.color;
}
