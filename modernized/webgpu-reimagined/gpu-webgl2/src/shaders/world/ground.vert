#version 300 es
// R-MAP-001 ground vertex stage (legacy Map/Ground.vs): per-vertex light weighting.
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aVertexNormal;
layout(location = 2) in vec2 aTextureCoord;
layout(location = 3) in vec2 aLightmapCoord;
layout(location = 4) in vec2 aTileColorCoord;

out vec2 vTextureCoord;
out vec2 vLightmapCoord;
out vec2 vTileColorCoord;
out float vLightWeighting;

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;
uniform vec3 uLightDirection;

void main(void) {
	gl_Position = uProjectionMat * uModelViewMat * vec4(aPosition, 1.0);

	vTextureCoord = aTextureCoord;
	vLightmapCoord = aLightmapCoord;
	vTileColorCoord = aTileColorCoord;

	float dotProduct = dot(aVertexNormal, uLightDirection);
	vLightWeighting = max(dotProduct, 0.0);
}
