#version 300 es
// R-MAP-012 static RSM batch (legacy Effects/Shaders/GLSL/Models.vs), plus the
// texture-array layer and size/class scale of each vertex's texture.
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aVertexNormal;
layout(location = 2) in vec2 aTextureCoord;
layout(location = 3) in float aAlpha;
layout(location = 4) in vec3 aLayer;

out vec2 vTextureCoord;
out float vLightWeighting;
out float vAlpha;
out vec3 vWorldPos;
flat out float vLayer;
flat out vec2 vScale;

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;
uniform vec3 uLightDirection;

void main(void) {
	gl_Position = uProjectionMat * uModelViewMat * vec4(aPosition, 1.0);

	vTextureCoord = aTextureCoord;
	vAlpha = aAlpha;
	vWorldPos = aPosition;
	vLayer = aLayer.x;
	vScale = aLayer.yz;

	float dotProduct = dot(aVertexNormal, uLightDirection);
	vLightWeighting = max(dotProduct, 0.0);
}
