#version 300 es
// R-MAP-017 animated RSM (legacy Map/AnimatedModels.vs): node·instance matrices from an
// RGBA32F palette shared by every animated model of the map (4 texels per matrix,
// rows of uPaletteWidth texels), plus the texture-array layer of each vertex.
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoord;
layout(location = 3) in float aAlpha;
layout(location = 4) in vec3 aLayer;
layout(location = 5) in float aMatrixIndex;

out vec2 vTextureCoord;
out float vLightWeighting;
out float vAlpha;
out vec3 vWorldPos;
flat out float vLayer;
flat out vec2 vScale;

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

uniform vec3 uLightDirection;
uniform float uLightOpacity;

uniform highp sampler2D uMatrixTexture;
uniform int uPaletteWidth;

vec4 fetchTexel(int pixel) {
	return texelFetch(uMatrixTexture, ivec2(pixel % uPaletteWidth, pixel / uPaletteWidth), 0);
}

mat4 fetchMatrix(int index) {
	int pixelIndex = index * 4;
	vec4 row0 = fetchTexel(pixelIndex);
	vec4 row1 = fetchTexel(pixelIndex + 1);
	vec4 row2 = fetchTexel(pixelIndex + 2);
	vec4 row3 = fetchTexel(pixelIndex + 3);
	return mat4(row0, row1, row2, row3);
}

void main(void) {
	mat4 M = fetchMatrix(int(aMatrixIndex));
	vec4 worldPos = M * vec4(aPosition, 1.0);
	vec4 position = uModelViewMat * worldPos;
	gl_Position = uProjectionMat * position;

	vTextureCoord = aTextureCoord;
	vAlpha = aAlpha;
	vWorldPos = worldPos.xyz;
	vLayer = aLayer.x;
	vScale = aLayer.yz;

	vec3 c0 = normalize(M[0].xyz);
	vec3 c1 = normalize(M[1].xyz);
	vec3 c2 = normalize(M[2].xyz);
	mat3 rotMat = mat3(c0, c1, c2);
	vec3 normal = normalize(rotMat * aNormal);

	float lightWeight = max(dot(normal, uLightDirection), 0.0);
	vLightWeighting = (1.0 - uLightOpacity) + lightWeight * uLightOpacity;
}
