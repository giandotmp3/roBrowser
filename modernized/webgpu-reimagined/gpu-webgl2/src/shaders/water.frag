#version 300 es
// R-MAP-010 (fixed): opacity applied once (legacy squared it); texture alpha ignored; unlit.
// R-MAP-009: the frame is a layer of the 32-frame water array, sampled in its top-left
// size/class part (uScale) with the legacy LINEAR + CLAMP_TO_EDGE result.
precision highp float;

in vec2 vTextureCoord;
out vec4 fragColor;

uniform highp sampler2DArray uWater;
uniform float uLayer;
uniform vec2 uScale;
uniform float uOpacity;

#include "fog.glsl"

void main(void) {
	vec3 rgb = texture(uWater, vec3(vTextureCoord.st * uScale, uLayer)).rgb;
	if (uOpacity == 0.0) {
		discard;
	}
	fragColor = applyFog(vec4(rgb, uOpacity));
}
