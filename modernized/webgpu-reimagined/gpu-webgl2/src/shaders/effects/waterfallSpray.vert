#version 300 es
// waterfallSpray: legacy WaterfallParticle.vs. One instance per seed (aSeed), the
// record's fields repeated on each: iModel0..3 = uModelMat columns, iMisc = (uTime,
// uSize, fog).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
out float vAlpha;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

// Spray puffs rise from the pool for RISE units after waiting below it.
const float CYCLE = 38.0;
const float RISE = 8.0;
const float DELAY = CYCLE - RISE;

void main(void) {
	mat4 uModelMat = mat4(iModel0, iModel1, iModel2, iModel3);
	float uTime = iMisc.x;
	float uSize = iMisc.y;
	vColor = iColor;
	vTex = iTex;
	vFog = iMisc.z;

	float life = fract(aSeed.z + uTime);
	float t = life * CYCLE - DELAY;

	if (t <= 0.0) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		vTextureCoord = vec2(0.0);
		vAlpha = 0.0;
		return;
	}

	float progress = t / RISE;
	float drift = sin(aSeed.w + progress * 3.0) * 0.3;
	vec3 local = vec3(aSeed.x + drift, -t * 0.2, aSeed.y);
	vec4 viewPosition = uModelViewMat * uModelMat * vec4(local, 1.0);
	viewPosition.xy += aCorner * uSize;

	gl_Position = uProjectionMat * viewPosition;
	vTextureCoord = aCorner * 0.5 + 0.5;
	vAlpha = 0.08 * min(1.0, progress * 8.0) * (1.0 - smoothstep(0.5, 1.0, progress));
}
