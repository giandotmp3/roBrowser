#version 300 es
// groundAura: legacy GroundAura.vs. iPosition = uWorldPosition, iShape = (uSize, uAngle,
// uZIndex).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;

void main(void) {
	vec3 uWorldPosition = iPosition.xyz;
	vec2 uSize = iShape.xy;
	float uAngle = iShape.z;

	// Convert size from SpriteRenderer units to world units
	// SpriteRenderer does: size / 175.0 * 5.0 = size / 35.0
	float sizeX = uSize.x / 35.0;
	float sizeY = uSize.y / 35.0;

	// Scale the quad by size
	vec3 pos = vec3(aPosition.x * sizeX, aPosition.y, aPosition.z * sizeY);

	// Rotate around Y axis by angle
	float cosA = cos(uAngle);
	float sinA = sin(uAngle);
	vec3 rotatedPos = vec3(
		pos.x * cosA - pos.z * sinA,
		pos.y,
		pos.x * sinA + pos.z * cosA
	);

	// World position following RO coordinate system: x, -z (height), y
	vec3 worldPos = vec3(
		uWorldPosition.x + 0.5 + rotatedPos.x,
		-uWorldPosition.z + rotatedPos.y,
		uWorldPosition.y + 0.5 + rotatedPos.z
	);

	gl_Position = uProjectionMat * uModelViewMat * vec4(worldPos, 1.0);
	gl_Position.z -= iShape.w * 0.01;

	vTextureCoord = aTextureCoord;
	vColor = iColor;
	vTex = iTex;
}
