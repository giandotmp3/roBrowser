#version 300 es
// level99Bubble: legacy Level99Bubble.vs over the billboard quad of the record (per-record
// vertex data). iMisc = (uZIndex, fog).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

void main(void) {
	gl_Position = uProjectionMat * uModelViewMat * vec4(aPosition, 1.0);
	gl_Position.z -= iMisc.x;
	vTextureCoord = aTextureCoord;
	vColor = iColor;
	vTex = iTex;
	vFog = iMisc.y;
}
