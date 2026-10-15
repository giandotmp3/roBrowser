#version 300 es
// Instanced sprite quad (run batching): one instance per SpriteDraw record.
// Reproduces legacy Renderer/SpriteRenderer.vs operation for operation; the
// per-draw uniforms became per-instance attributes.
// R-SPR-002 spherical billboard, R-SPR-005 depth correction (+ ignoreDepthMinCap),
// R-SPR-006 zIndex bias.
precision highp float;

layout(location = 0) in vec2 aCorner;      // per-vertex: legacy quad position (+-0.5)
layout(location = 1) in vec2 aTexCoord;    // per-vertex: legacy quad uv
layout(location = 2) in vec3 aPosition;    // per-instance from here on
layout(location = 3) in vec2 aOffset;      // world units, legacy _offset (y already - 0.5)
layout(location = 4) in vec2 aSize;        // world units, signed (mirror = negative width)
layout(location = 5) in vec2 aRotation;    // (cos, sin) of -angle, as legacy mat4.rotateZ
layout(location = 6) in vec4 aColor;
layout(location = 7) in float aShadow;
layout(location = 8) in float aZIndex;
layout(location = 9) in float aDepthBias;
layout(location = 10) in vec2 aDepthFlags; // x: depthCorrection, y: ignoreDepthMinCap
layout(location = 11) in vec4 aLayer;      // x: array layer, y: palette row, z: POT class, w: sampler
layout(location = 12) in vec4 aFrame;      // xy: frame size (px), zw: palette bilinear size (legacy uTextSize)

uniform mat4 uModelView;
uniform mat4 uViewModel;                   // inverse(uModelView), computed on the CPU as legacy does
uniform mat4 uProjection;
uniform float uZoom;

out vec2 vUv;
flat out vec4 vColor;
flat out float vShadow;
flat out vec4 vLayer;
flat out vec4 vFrame;

// R-SPR-002: translate to the sprite (x, -z, y) + half a cell, then drop the view rotation.
mat4 project(mat4 mat, vec3 pos) {
	float x = pos.x + 0.5;
	float y = -pos.z;
	float z = pos.y + 0.5;

	mat[3].x += mat[0].x * x + mat[1].x * y + mat[2].x * z;
	mat[3].y += mat[0].y * x + mat[1].y * y + mat[2].y * z;
	mat[3].z += (mat[0].z * x + mat[1].z * y + mat[2].z * z);
	mat[3].w += mat[0].w * x + mat[1].w * y + mat[2].w * z;

	mat[0].xyz = vec3(1.0, 0.0, 0.0);
	mat[1].xyz = vec3(0.0, 1.0, 0.0);
	mat[2].xyz = vec3(0.0, 0.0, 1.0);

	return mat;
}

void main() {
	mat4 angle = mat4(
		aRotation.x, aRotation.y, 0.0, 0.0,
		-aRotation.y, aRotation.x, 0.0, 0.0,
		0.0, 0.0, 1.0, 0.0,
		0.0, 0.0, 0.0, 1.0
	);
	vec4 position = angle * vec4(aCorner.x * aSize.x, aCorner.y * aSize.y, 0.0, 1.0);
	position.x += aOffset.x;
	position.y -= aOffset.y + 0.5;

	mat4 modelView = project(uModelView, aPosition);
	vec4 viewPosition = modelView * position;
	vec4 viewCenter = modelView * vec4(0.0, 0.0, 0.0, 1.0);

	vec4 clip = uProjection * viewPosition;

	// R-SPR-005: the vertex takes the depth where its camera ray meets the vertical
	// plane through the sprite centre (normal = flattened camera forward), capped with
	// min(original, corrected) unless ignoreDepthMinCap (NPCs).
	if (aDepthFlags.x > 0.5) {
		vec3 cameraPos = (uViewModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
		vec3 cameraForward = normalize((uViewModel * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
		vec3 planePoint = (uViewModel * viewCenter).xyz;
		vec3 planeNormal = normalize(vec3(cameraForward.x, 0.0, cameraForward.z));
		if (length(planeNormal) < 0.000001) {
			planeNormal = cameraForward;
		}

		vec3 worldVertex = (uViewModel * viewPosition).xyz;
		vec3 rayDir = normalize(worldVertex - cameraPos);
		float denom = max(dot(planeNormal, rayDir), 0.000001);
		float dist = dot(planePoint - cameraPos, planeNormal) / denom;

		vec4 planeClip = uProjection * (uModelView * vec4(cameraPos + rayDir * dist, 1.0));
		float correctedZBase = planeClip.z * (clip.w / max(planeClip.w, 0.000001));

		clip.z = aDepthFlags.y > 0.5 ? correctedZBase : min(clip.z, correctedZBase);
	}

	// R-SPR-006: later layers win ties.
	clip.z -= (aZIndex * 0.01 + aDepthBias) / max(uZoom, 1.0);

	gl_Position = clip;
	vUv = aTexCoord;
	vColor = aColor;
	vShadow = aShadow;
	vLayer = aLayer;
	vFrame = aFrame;
}
