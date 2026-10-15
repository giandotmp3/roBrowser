#version 300 es
// swirlingAura: legacy SwirlingAura.fs.
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in vec4 vColor;
flat in vec4 vTex;
flat in float vFog;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	vec4 texColor = effectTexture(vTex, vTextureCoord);

	if (texColor.a < 0.01) {
		discard;
	}

	// Discard near-black pixels
	if (texColor.r < 0.01 && texColor.g < 0.01 && texColor.b < 0.01) {
		discard;
	}

	fragColor = texColor * vColor;

	if (vFog > 0.5) {
		float depth = gl_FragCoord.z / gl_FragCoord.w;
		float fogFactor = smoothstep(uFogNear, uFogFar, depth);
		fragColor = mix(fragColor, vec4(uFogColor, fragColor.w), fogFactor);
	}
}
