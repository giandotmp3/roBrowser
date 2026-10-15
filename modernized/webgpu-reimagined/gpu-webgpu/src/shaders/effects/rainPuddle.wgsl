// rainPuddle: legacy RainWeather.vs/.fs (procedural ripples, fresnel, sky reflection; as
// gpu-webgl2 rainPuddle.vert/.frag). iPosition = (uWorldPosition, size), iShape = (uAngle,
// uZIndex, uTime, fog), iCamera = uCameraPos.

struct VertexIn {
  @location(0) aPosition : vec3f,
  @location(1) aTextureCoord : vec2f,
  @location(2) iPosition : vec4f,
  @location(3) iShape : vec4f,
  @location(4) iColor : vec4f,
  @location(5) iCamera : vec4f,
  @location(6) iTex : vec4f,
};

struct VsOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) worldPos : vec3f,
  @location(2) @interpolate(flat) color : vec4f,
  @location(3) @interpolate(flat) shape : vec4f,
  @location(4) @interpolate(flat) camera : vec3f,
  @location(5) @interpolate(flat) tex : vec4f,
};

@vertex
fn vs_main(v : VertexIn) -> VsOut {
  let uWorldPosition = v.iPosition.xyz;
  let uSize = vec2f(v.iPosition.w, v.iPosition.w);
  let uAngle = v.iShape.x;

  // Size from SpriteRenderer units to world units.
  let sizeX = uSize.x / 35.0;
  let sizeY = uSize.y / 35.0;

  let pos = vec3f(v.aPosition.x * sizeX, v.aPosition.y, v.aPosition.z * sizeY);

  // Rotate around the Y axis.
  let cosA = cos(uAngle);
  let sinA = sin(uAngle);
  let rotatedPos = vec3f(pos.x * cosA - pos.z * sinA, pos.y, pos.x * sinA + pos.z * cosA);

  var o : VsOut;
  // RO coordinate system: x, -z (height), y.
  o.worldPos = vec3f(
    uWorldPosition.x + 0.5 + rotatedPos.x,
    -uWorldPosition.z + rotatedPos.y,
    uWorldPosition.y + 0.5 + rotatedPos.z
  );

  var clip = frame.projection * frame.model_view * vec4f(o.worldPos, 1.0);
  clip.z -= v.iShape.y * 0.01;

  o.pos = gl_to_webgpu(clip);
  o.uv = v.aTextureCoord;
  o.color = v.iColor;
  o.shape = v.iShape;
  o.camera = v.iCamera.xyz;
  o.tex = v.iTex;
  return o;
}

@fragment
fn fs_main(i : VsOut) -> @location(0) vec4f {
  if (i.tex.x < 0.0) {
    discard;
  }
  let uTime = i.shape.z;
  let uCameraPos = i.camera;
  let uv = i.uv;
  let center = vec2f(0.5, 0.5);
  let dist = distance(uv, center);

  // Multi-layered procedural ripples.
  let wave1 = sin(dist * 20.0 - uTime * 2.2) * 0.5 + 0.5;
  let wave2 = sin(dist * 12.0 + uTime * 1.4 + i.worldPos.x * 0.5) * 0.5 + 0.5;
  let combinedWave = (wave1 * 0.7 + wave2 * 0.3) * (1.0 - dist * 2.0);

  // Distort uv along the waves (refraction look).
  let distortedUV = uv + (uv - center) * combinedWave * 0.035;
  var texColor = effect_texture(i.tex, distortedUV);

  if (texColor.a < 0.01) {
    discard;
  }

  // Fresnel: water reflects more at shallow angles.
  let viewDir = normalize(uCameraPos - i.worldPos);
  let fresnel = pow(1.0 - max(0.0, dot(viewDir, vec3f(0.0, 1.0, 0.0))), 3.5);

  // Fake sky reflection.
  let skyReflect = vec3f(0.88, 0.92, 1.0);
  let reflectFactor = (pow(combinedWave, 2.5) * 0.45 + fresnel * 0.5) * 0.8;

  var rgb = texColor.rgb * 0.98;
  rgb = mix(rgb, skyReflect, vec3f(reflectFactor));

  // Specular highlight on wave peaks.
  let shine = pow(combinedWave, 8.0) * 0.55 + fresnel * 0.1;
  rgb += vec3f(shine);
  texColor = vec4f(rgb, texColor.a);

  var finalColor = texColor * i.color;

  if (i.shape.w > 0.5) {
    let fogFactor = effect_fog_factor(i.pos);
    finalColor = vec4f(mix(finalColor.rgb, frame.fog_color, vec3f(fogFactor)), finalColor.a);
  }
  return finalColor;
}
