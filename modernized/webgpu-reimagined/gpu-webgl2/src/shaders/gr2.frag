#version 300 es
// C-14 GR2 (legacy Renderer/GR2/GR2Model.fs, same arithmetic).
// R-GR2-002: hard alpha test, texels with alpha < 207/255 are discarded and the
// rest are opaque (uAlpha is the entity alpha, 1 unless fading).
// R-GR2-001: per-model grey diffuse/ambient (uLightDiffuse/uLightAmbient).
precision highp float;

in vec2 vTextureCoord;
in float vLightWeighting;
out vec4 fragColor;

uniform sampler2D uDiffuse;
uniform float uAlphaRef;      // 207/255 (GR2_ALPHA_REF), a uniform as in legacy so the float is identical
uniform float uAlpha;

uniform vec3 uLightAmbient;
uniform vec3 uLightDiffuse;
uniform vec3 uLightEnv;

#include "fog.glsl"

void main(void) {
	vec4 textureSample = texture(uDiffuse, vTextureCoord.st);
	if (textureSample.a < uAlphaRef) {
		discard;
	}
	vec3 color = (vLightWeighting * uLightDiffuse + uLightAmbient);
	textureSample.rgb *= clamp(color, 0.0, 1.0);
	textureSample.rgb *= clamp(uLightEnv, 0.0, 1.0);
	textureSample.a = uAlpha;
	fragColor = applyFog(textureSample);
}
