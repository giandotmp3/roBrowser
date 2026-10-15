#version 300 es
// swirlingAura: legacy SwirlingAura.vs over the band mesh of the record (per-record
// vertex data, de-indexed in index order). uModelMat is the identity translated by the
// record position (legacy mat4.translate on the identity); iMisc = (uZIndex, fog).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

void main(void) {
	mat4 uModelMat = mat4(
		1.0, 0.0, 0.0, 0.0,
		0.0, 1.0, 0.0, 0.0,
		0.0, 0.0, 1.0, 0.0,
		iTranslation.x, iTranslation.y, iTranslation.z, 1.0
	);
	vec4 worldPos = uModelMat * vec4(aPosition, 1.0);
	gl_Position = uProjectionMat * uModelViewMat * worldPos;
	gl_Position.z -= iMisc.x;
	vTextureCoord = aTextureCoord;
	vColor = iColor;
	vTex = iTex;
	vFog = iMisc.y;
}
