#version 300 es
// R-MAP-021 grid selector (legacy Map/GridSelector.fs); R-MAP-004 fog.
precision highp float;

in vec2 vTextureCoord;
out vec4 fragColor;

uniform sampler2D uDiffuse;

#include "fog.glsl"

void main(void) {
	vec4 textureSample = texture(uDiffuse, vTextureCoord.st);
	if (textureSample.a == 0.0) {
		discard;
	}
	fragColor = applyFog(textureSample);
}
