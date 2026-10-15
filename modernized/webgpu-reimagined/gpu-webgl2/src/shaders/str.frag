#version 300 es
// R-EFX-009 STR layer: texture x colour, discarded when the result has zero alpha or
// is pure black (legacy StrEffect.fs tests the product, not the texel).
// R-EFX-010 (fixed): the layer obeys the scene fog through the shared include when its
// record asks for it (legacy never set uFogUse for STR).
// The texture is an rgba8 texture-array layer (residency); the image sits in the
// layer's top-left corner, edge-replicated, so LINEAR over uv * (size / class) equals
// legacy's per-texture LINEAR + CLAMP_TO_EDGE.
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uRgba[5];   // rgba8 pools by POT class (32..512), LINEAR

in vec2 vUv;
flat in vec4 vColor;
flat in vec4 vTex;
flat in float vFog;
out vec4 fragColor;

#include "fog.glsl"

vec4 sampleLayer(vec3 p) {
	int c = int(vTex.y);
	if (c == 0) {
		return textureLod(uRgba[0], p, 0.0);
	}
	if (c == 1) {
		return textureLod(uRgba[1], p, 0.0);
	}
	if (c == 2) {
		return textureLod(uRgba[2], p, 0.0);
	}
	if (c == 3) {
		return textureLod(uRgba[3], p, 0.0);
	}
	return textureLod(uRgba[4], p, 0.0);
}

void main(void) {
	// Not resident (residency miss): nothing to draw.
	if (vTex.x < 0.0) {
		discard;
	}
	vec4 color = sampleLayer(vec3(vUv * vTex.zw, vTex.x)) * vColor;
	if (color.a == 0.0 || (color.r == 0.0 && color.g == 0.0 && color.b == 0.0)) {
		discard;
	}
	fragColor = vFog > 0.5 ? applyFog(color) : color;
}
