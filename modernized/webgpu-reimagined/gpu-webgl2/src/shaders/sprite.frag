#version 300 es
// R-SPR-014 indexed palette sprites with the legacy manual bilinear palette lookup;
// R-SPR-016/017 RGBA frames and final colour; R-SPR-012 shadow factor; R-MAP-004 fog.
// Frames live in texture-array pools per POT class (32..512); a frame occupies the
// top-left frameSize corner of its layer. Sampling emulates the legacy per-frame
// texture exactly: NEAREST + CLAMP_TO_EDGE via clamped texelFetch, LINEAR via the
// hardware filter over an edge-replicated layer (TextureArrayPools.padLayer).
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uIndexed[5];   // r8 pools, NEAREST
uniform sampler2DArray uRgba[5];      // rgba8 pools, LINEAR
uniform highp sampler2D uPalettes;    // 256xN RGBA table, NEAREST
uniform bool uIndexedRun;

in vec2 vUv;
flat in vec4 vColor;
flat in float vShadow;
flat in vec4 vLayer;
flat in vec4 vFrame;
out vec4 fragColor;

#include "fog.glsl"

float fetchIndex(ivec3 p) {
	int c = int(vLayer.z);
	if (c == 0) {
		return texelFetch(uIndexed[0], p, 0).r;
	}
	if (c == 1) {
		return texelFetch(uIndexed[1], p, 0).r;
	}
	if (c == 2) {
		return texelFetch(uIndexed[2], p, 0).r;
	}
	if (c == 3) {
		return texelFetch(uIndexed[3], p, 0).r;
	}
	return texelFetch(uIndexed[4], p, 0).r;
}

vec4 fetchRgba(ivec3 p) {
	int c = int(vLayer.z);
	if (c == 0) {
		return texelFetch(uRgba[0], p, 0);
	}
	if (c == 1) {
		return texelFetch(uRgba[1], p, 0);
	}
	if (c == 2) {
		return texelFetch(uRgba[2], p, 0);
	}
	if (c == 3) {
		return texelFetch(uRgba[3], p, 0);
	}
	return texelFetch(uRgba[4], p, 0);
}

vec4 filterRgba(vec3 p) {
	int c = int(vLayer.z);
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

// Legacy texture(frame, uv) on a NEAREST, CLAMP_TO_EDGE frame texture.
ivec3 nearestTexel(vec2 uv) {
	ivec2 t = clamp(ivec2(floor(uv * vFrame.xy)), ivec2(0), ivec2(vFrame.xy) - 1);
	return ivec3(t, int(vLayer.x));
}

// Legacy texture(LUT, vec2(i, 1.0)): 256 wide, NEAREST. Legacy's default REPEAT wrap
// sends index 255 (normalised 1.0) to column 0; the rebuild clamps so it shows entry
// 255 (spec #64, HITL delegated policy).
vec4 paletteAt(float i) {
	int column = min(int(floor(i * 256.0)), 255);
	return vec4(texelFetch(uPalettes, ivec2(column, int(vLayer.y)), 0).rgb, 1.0);
}

// Legacy bilinearSample: four NEAREST index taps 1/uTextSize apart, index 0 is
// transparent, palette colours blended with f = fract(uv * uTextSize).
vec4 sampleIndexed() {
	vec2 interval = 1.0 / vFrame.zw;
	float i00 = fetchIndex(nearestTexel(vUv));
	float i10 = fetchIndex(nearestTexel(vUv + vec2(interval.x, 0.0)));
	float i01 = fetchIndex(nearestTexel(vUv + vec2(0.0, interval.y)));
	float i11 = fetchIndex(nearestTexel(vUv + interval));
	vec4 c00 = i00 == 0.0 ? vec4(0.0) : paletteAt(i00);
	vec4 c10 = i10 == 0.0 ? vec4(0.0) : paletteAt(i10);
	vec4 c01 = i01 == 0.0 ? vec4(0.0) : paletteAt(i01);
	vec4 c11 = i11 == 0.0 ? vec4(0.0) : paletteAt(i11);
	vec2 f = fract(vUv * vFrame.zw);
	return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

vec4 sampleRgba() {
	if (vLayer.w < 0.5) {
		return fetchRgba(nearestTexel(vUv));
	}
	float classSize = float(32 << int(vLayer.z));
	return filterRgba(vec3(vUv * (vFrame.xy / classSize), vLayer.x));
}

void main() {
	// Not resident (residency miss) or fully transparent colour: nothing to draw.
	if (vLayer.x < 0.0 || vColor.a == 0.0) {
		discard;
	}

	vec4 textureSample = uIndexedRun ? sampleIndexed() : sampleRgba();
	if (textureSample.a == 0.0) {
		discard;
	}

	// R-SPR-012 then R-SPR-017: rgb *= shadow, then tex * colour (legacy order).
	textureSample.rgb *= vShadow;
	fragColor = applyFog(textureSample * vColor);
}
