#version 300 es
// R-MAP-010 (fixed): opacity applied once; texture alpha ignored; unlit.
precision highp float;
uniform sampler2D uWater;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;

#include "fog.glsl"

void main() {
	vec3 rgb = texture(uWater, vUv).rgb;
	fragColor = applyFog(vec4(rgb, uOpacity));
}
