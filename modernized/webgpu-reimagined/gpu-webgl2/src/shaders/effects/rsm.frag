#version 300 es
// rsm: legacy RsmEffect.fs. The light is the family's constant light (legacy RsmEffect.js
// `_light`: ambient pi, diffuse 0, opacity 1), uploaded per pass.
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

uniform vec3  uLightAmbient;
uniform vec3  uLightDiffuse;
uniform float uLightOpacity;

in vec2 vTextureCoord;
in float vLightWeighting;
in float vAlpha;
flat in vec4 vTex;
flat in float vFog;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	vec4 textureSample  = effectTexture(vTex, vTextureCoord.st);

	if (textureSample.a == 0.0) {
		discard;
	}

	vec3 Ambient	= uLightAmbient * uLightOpacity;
	vec3 Diffuse	= uLightDiffuse * vLightWeighting;
	vec4 LightColor = vec4( Ambient + Diffuse, 1.0);

	fragColor	= textureSample * clamp(LightColor, 0.0, 1.0);
	fragColor.a *= vAlpha;

	if (vFog > 0.5) {
		float depth	 = gl_FragCoord.z / gl_FragCoord.w;
		float fogFactor = smoothstep( uFogNear, uFogFar, depth );
		fragColor	= mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
	}
}
