#version 300 es
// R-MAP-012 static and (R-MAP-013 fixed) animated RSM shading share this file; same
// arithmetic, in the same order, as legacy Models.fs / AnimatedModels.fs. R-MAP-020
// occluder fade (shared include). Textures are layers of a per-size-class array,
// sampled in their top-left size/class part (vScale, exact powers of two).
precision highp float;

in vec2 vTextureCoord;
in float vLightWeighting;
in float vAlpha;
in vec3 vWorldPos;
flat in float vLayer;
flat in vec2 vScale;
out vec4 fragColor;

uniform highp sampler2DArray uDiffuse;
uniform bool uLightmapUse;
uniform vec3 uLightAmbient;
uniform vec3 uLightDiffuse;
uniform vec3 uLightEnv;

#include "fog.glsl"
#include "occluderFade.glsl"

void main(void) {
	vec4 textureSample = texture(uDiffuse, vec3(vTextureCoord.st * vScale, vLayer));

	if (textureSample.a == 0.0) {
		discard;
	}

	if (!occluderFade(vWorldPos, textureSample.a)) {
		discard;
	}

	vec3 color = ((uLightmapUse ? vLightWeighting : 1.0) * uLightDiffuse + uLightAmbient);
	textureSample.rgb *= clamp(color, 0.0, 1.0);
	textureSample.rgb *= clamp(uLightEnv, 0.0, 1.0);
	textureSample.a *= vAlpha;

	fragColor = applyFog(textureSample);
}
