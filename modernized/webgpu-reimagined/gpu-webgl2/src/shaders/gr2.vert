#version 300 es
// C-14 GR2 skinned mesh (legacy Renderer/GR2/GR2Model.vs, same arithmetic). The bone
// palette comes from a std140 uniform block (one 48-matrix range per instance, bound
// with bindBufferRange) instead of a plain uniform array; the values are identical.
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoord;
layout(location = 3) in vec4 aBoneIndex;
layout(location = 4) in vec4 aBoneWeight;

out vec2 vTextureCoord;
out float vLightWeighting;

uniform mat4 uModelViewMat;   // view * instance world
uniform mat4 uProjectionMat;
uniform mat3 uNormalMat;      // normal matrix of (view * world)

// R-GR2-003: at most 48 bones (GR2_MAX_BONES).
layout(std140) uniform Gr2Bones {
	mat4 uBones[48];
};

uniform vec3 uLightDirection; // map light direction, view space
uniform float uLightOpacity;

void main(void) {
	mat4 skin = aBoneWeight.x * uBones[int(aBoneIndex.x)]
	          + aBoneWeight.y * uBones[int(aBoneIndex.y)]
	          + aBoneWeight.z * uBones[int(aBoneIndex.z)]
	          + aBoneWeight.w * uBones[int(aBoneIndex.w)];

	vec4 skinned = skin * vec4(aPosition, 1.0);
	gl_Position = uProjectionMat * uModelViewMat * skinned;

	vTextureCoord = aTextureCoord;

	vec3 normal = normalize(uNormalMat * (mat3(skin) * aNormal));
	float lightWeight = max(dot(normal, uLightDirection), 0.0);
	vLightWeighting = (1.0 - uLightOpacity) + lightWeight * uLightOpacity;
}
