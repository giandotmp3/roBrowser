#version 300 es
// R-SPR-014 indexed palette sprites with manual bilinear palette lookup;
// R-SPR-017 final colour; R-MAP-004 fog.
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uIndexed;   // r8 pools (NEAREST)
uniform sampler2DArray uRgba;      // rgba8 pools (LINEAR or NEAREST per instance)
uniform sampler2D uPalettes;       // 256×N RGBA table, NEAREST
uniform bool uIndexedRun;

in vec2 vUv;
in vec4 vColor;
flat in vec2 vLayer;
flat in float vSampler;
out vec4 fragColor;

#include "fog.glsl"

vec4 paletteAt(float idx) {
	return texelFetch(uPalettes, ivec2(int(idx), int(vLayer.y)), 0);
}

vec4 sampleIndexed() {
	vec2 size = vec2(textureSize(uIndexed, 0).xy);
	vec2 p = vUv * size - 0.5;
	vec2 f = fract(p);
	ivec2 b = ivec2(floor(p));
	float i00 = texelFetch(uIndexed, ivec3(b, int(vLayer.x)), 0).r * 255.0;
	float i10 = texelFetch(uIndexed, ivec3(b + ivec2(1, 0), int(vLayer.x)), 0).r * 255.0;
	float i01 = texelFetch(uIndexed, ivec3(b + ivec2(0, 1), int(vLayer.x)), 0).r * 255.0;
	float i11 = texelFetch(uIndexed, ivec3(b + ivec2(1, 1), int(vLayer.x)), 0).r * 255.0;
	// index 0 is transparent
	vec4 c00 = i00 == 0.0 ? vec4(0.0) : paletteAt(i00);
	vec4 c10 = i10 == 0.0 ? vec4(0.0) : paletteAt(i10);
	vec4 c01 = i01 == 0.0 ? vec4(0.0) : paletteAt(i01);
	vec4 c11 = i11 == 0.0 ? vec4(0.0) : paletteAt(i11);
	return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

void main() {
	vec4 tex = uIndexedRun ? sampleIndexed() : texture(uRgba, vec3(vUv, vLayer.x));
	if (tex.a == 0.0) { discard; }
	fragColor = applyFog(tex * vColor);
}
