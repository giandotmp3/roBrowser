#version 300 es
// waterfallSpray: legacy WaterfallParticle.fs (fog fades alpha; uColor is the record colour).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;

in vec2 vTextureCoord;
in float vAlpha;
flat in vec4 vColor;
flat in vec4 vTex;
flat in float vFog;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	fragColor = effectTexture(vTex, vTextureCoord);
	fragColor.rgb *= vColor.rgb;
	fragColor.a *= vAlpha;
	if (vFog > 0.5) {
		float fogFactor = smoothstep(uFogNear, uFogFar, gl_FragCoord.z / gl_FragCoord.w);
		fragColor.a *= 1.0 - fogFactor;
	}
	if (fragColor.a < 0.01) {
		discard;
	}
}
