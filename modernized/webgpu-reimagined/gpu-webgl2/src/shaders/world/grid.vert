#version 300 es
// R-MAP-021 grid selector (legacy Map/GridSelector.vs): lowered by 0.1 (RO's inverted Y).
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTextCoord;

out vec2 vTextureCoord;

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

void main(void) {
	vec3 position = aPosition;
	position.y -= 0.1;

	gl_Position = uProjectionMat * uModelViewMat * vec4(position.xyz, 1.0);
	vTextureCoord = aTextCoord;
}
