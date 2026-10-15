#version 300 es
// waterfall (curtain segment): legacy WaterfallEffect.fs. vMisc = (uOpacity, fog).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

in vec2 vTextureCoord;
flat in vec4 vMisc;
flat in vec4 vTex;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	fragColor = effectTexture(vTex, vTextureCoord);
	fragColor.a *= vMisc.x;
	if (fragColor.a < 0.01) {
		discard;
	}
	if (vMisc.y > 0.5) {
		float fogFactor = smoothstep(uFogNear, uFogFar, gl_FragCoord.z / gl_FragCoord.w);
		fragColor = mix(fragColor, vec4(uFogColor, fragColor.a), fogFactor);
	}
}
