#version 300 es
// Instanced sprite quad (run batching). R-SPR-002 spherical billboard,
// R-SPR-005 depth correction, R-SPR-006 zIndex bias.
precision highp float;

layout(location = 0) in vec2 aCorner;      // unit quad corner, per-vertex
layout(location = 1) in vec3 aPosition;    // per-instance from here on
layout(location = 2) in vec2 aOffset;
layout(location = 3) in vec2 aSize;
layout(location = 4) in float aAngle;
layout(location = 5) in float aMirror;
layout(location = 6) in vec4 aColor;
layout(location = 7) in float aShadow;
layout(location = 8) in float aZIndex;
layout(location = 9) in float aDepthBias;
layout(location = 10) in vec2 aDepthFlags;
layout(location = 11) in vec2 aLayer;
layout(location = 12) in float aSampler;

uniform mat4 uModelView;
uniform mat4 uProjection;
uniform float uZoom;

out vec2 vUv;
out vec4 vColor;
flat out vec2 vLayer;
flat out float vSampler;

void main() {
	vec2 c = aCorner;
	if (aMirror > 0.5) { c.x = -c.x; }
	float s = sin(radians(aAngle));
	float k = cos(radians(aAngle));
	vec2 local = vec2(c.x * k - c.y * s, c.x * s + c.y * k) * aSize + aOffset;

	// R-SPR-002: translate to the sprite, then drop the view rotation.
	vec4 viewPos = uModelView * vec4(aPosition.x + 0.5, -aPosition.z, aPosition.y + 0.5, 1.0);
	viewPos.xy += local;
	vec4 clip = uProjection * viewPos;

	// R-SPR-005: corrected depth (TODO: ray/vertical-plane intersection, see sprites/depth.js).
	// R-SPR-006: later layers win ties.
	clip.z -= (aZIndex * 0.01 + aDepthBias) / max(uZoom, 1.0);

	gl_Position = clip;
	vUv = aCorner * 0.5 + 0.5;
	vColor = vec4(aColor.rgb * aShadow, aColor.a);
	vLayer = aLayer;
	vSampler = aSampler;
}
