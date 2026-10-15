#version 300 es
// rainPuddle: legacy RainWeather.vs. iPosition = (uWorldPosition, size), iShape =
// (uAngle, uZIndex, uTime, fog), iCamera = uCameraPos.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
out vec3 vWorldPos;
flat out vec4 vColor;
flat out vec4 vShape;
flat out vec3 vCamera;
flat out vec4 vTex;

void main(void) {
	vec3 uWorldPosition = iPosition.xyz;
	vec2 uSize = vec2(iPosition.w, iPosition.w);
	float uAngle = iShape.x;

	// Convert size from SpriteRenderer units to world units
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
	vWorldPos = vec3(
		uWorldPosition.x + 0.5 + rotatedPos.x,
		-uWorldPosition.z + rotatedPos.y,
		uWorldPosition.y + 0.5 + rotatedPos.z
	);

	gl_Position = uProjectionMat * uModelViewMat * vec4(vWorldPos, 1.0);
	gl_Position.z -= iShape.y * 0.01;

	vTextureCoord = aTextureCoord;
	vColor = iColor;
	vShape = iShape;
	vCamera = iCamera.xyz;
	vTex = iTex;
}
