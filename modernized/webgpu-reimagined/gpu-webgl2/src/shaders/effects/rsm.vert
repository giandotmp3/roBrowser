#version 300 es
// rsm: legacy RsmEffect.vs over the object's vertices of the record (per-record vertex
// data: position, normal, uv, alpha). iPosition = (uPosition, uSize). uNormalMat is the
// pass normal matrix (legacy mat4.toInverseMat3 + mat3.transpose of the model-view).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

uniform vec3 uLightDirection;
uniform mat3 uNormalMat;

out vec2 vTextureCoord;
out float vLightWeighting;
out float vAlpha;
flat out vec4 vTex;
flat out float vFog;

void main(void) {

	vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z, iPosition.y + 0.5, 1.0);
	position += vec4(aPosition.x * iPosition.w, aPosition.y * -iPosition.w, aPosition.z * iPosition.w, 0.0);

	gl_Position	 = uProjectionMat * uModelViewMat * position;

	vTextureCoord   = aTextureCoord;
	vAlpha		  = aAlpha;

	vec4 lDirection  = uModelViewMat * vec4( uLightDirection, 0.0);
	vec3 dirVector   = normalize(lDirection.xyz);
	float dotProduct = dot( uNormalMat * aVertexNormal, dirVector );
	vLightWeighting  = max( dotProduct, 0.5 );
	vTex = iTex;
	vFog = iMisc.x;
}
