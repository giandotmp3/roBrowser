#version 300 es
// R-PP-006 FXAA (HITL round 2). Mirrors the CPU reference src/post/fxaa.js line for line.
// Edge path: legacy Shaders/GLSL/FXAA.fs (Rec.601 luma, threshold, span 8, reduce 1/32 and 1/128).
// uSubpix (fxaaSubpix) drives the standard FXAA 3.11 (quality) subpixel aliasing removal term; 0 = off (legacy result).
precision highp float;
uniform sampler2D uTexture;
uniform float uSubpix;
uniform float uEdgeThreshold;
uniform float uEdgeThresholdMin;
uniform float uSpan;
uniform float uReduceMul;
uniform float uReduceMin;
uniform vec2 uTexelSize;
in vec2 vUv;
out vec4 fragColor;

float fxaaLuma(vec3 c) {
	return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 tap(vec2 off) {
	return texture(uTexture, vUv + off * uTexelSize).rgb;
}

void main() {
	vec3 rgbM = tap(vec2(0.0, 0.0));
	float m = fxaaLuma(rgbM);
	float nw = fxaaLuma(tap(vec2(-1.0, -1.0)));
	float ne = fxaaLuma(tap(vec2(1.0, -1.0)));
	float sw = fxaaLuma(tap(vec2(-1.0, 1.0)));
	float se = fxaaLuma(tap(vec2(1.0, 1.0)));
	float lumaMin = min(m, min(min(nw, ne), min(sw, se)));
	float lumaMax = max(m, max(max(nw, ne), max(sw, se)));
	if (lumaMax - lumaMin < max(uEdgeThresholdMin, lumaMax * uEdgeThreshold)) {
		fragColor = vec4(rgbM, 1.0);
		return;
	}

	// Legacy edge path (FXAA.fs).
	vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
	float dirReduce = max((nw + ne + sw + se) * uReduceMul, uReduceMin);
	float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
	dir = clamp(dir * rcpDirMin, vec2(-uSpan), vec2(uSpan));
	vec3 rgbA = 0.5 * (tap(dir * (1.0 / 3.0 - 0.5)) + tap(dir * (2.0 / 3.0 - 0.5)));
	vec3 rgbB = rgbA * 0.5 + 0.25 * (tap(dir * -0.5) + tap(dir * 0.5));
	float lumaB = fxaaLuma(rgbB);
	vec3 rgbEdge = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;

	// FXAA 3.11 subpixel aliasing removal.
	float n = fxaaLuma(tap(vec2(0.0, -1.0)));
	float s = fxaaLuma(tap(vec2(0.0, 1.0)));
	float w = fxaaLuma(tap(vec2(-1.0, 0.0)));
	float e = fxaaLuma(tap(vec2(1.0, 0.0)));
	float range = max(max(m, max(n, s)), max(w, e)) - min(min(m, min(n, s)), min(w, e));
	float subpixA = (n + s + w + e) * 2.0 + (nw + sw + ne + se);
	float subpixB = subpixA * (1.0 / 12.0) - m;
	float subpixC = range > 0.0 ? clamp(abs(subpixB) / range, 0.0, 1.0) : 0.0;
	float subpixD = -2.0 * subpixC + 3.0;
	float subpixE = subpixC * subpixC;
	float subpixF = subpixD * subpixE;
	float subpixG = subpixF * subpixF;
	float subpixH = subpixG * uSubpix;

	// FXAA 3.11 edge orientation: the steeper neighbour across the edge.
	float edgeHorz = abs(-2.0 * w + (nw + sw)) + abs(-2.0 * m + (n + s)) * 2.0 + abs(-2.0 * e + (ne + se));
	float edgeVert = abs(-2.0 * s + (sw + se)) + abs(-2.0 * m + (w + e)) * 2.0 + abs(-2.0 * n + (nw + ne));
	bool horzSpan = edgeHorz >= edgeVert;
	float lumaN = horzSpan ? n : w;
	float lumaS = horzSpan ? s : e;
	float lengthSign = abs(lumaN - m) >= abs(lumaS - m) ? -1.0 : 1.0;
	vec2 across = horzSpan ? vec2(0.0, lengthSign) : vec2(lengthSign, 0.0);
	vec3 rgbAcross = tap(across);
	float toAcross = fxaaLuma(rgbAcross) - m;
	float edgeBlend = toAcross != 0.0 ? clamp((fxaaLuma(rgbEdge) - m) / toAcross, 0.0, 1.0) : 1.0;

	// Final blend = max(edge blend, subpixH): the legacy edge result unless subpix moves further.
	fragColor = max(edgeBlend, subpixH) == edgeBlend ? vec4(rgbEdge, 1.0) : vec4(mix(rgbM, rgbAcross, subpixH), 1.0);
}
