#version 300 es
// R-MAP-001/002/003 ground shading; R-MAP-004 fog. Same arithmetic, in the same order,
// as legacy Map/Ground.fs (the light weighting comes from the vertex stage).
precision highp float;

in vec2 vTextureCoord;
in vec2 vLightmapCoord;
in vec2 vTileColorCoord;
in float vLightWeighting;
out vec4 fragColor;

uniform sampler2D uDiffuse;
uniform sampler2D uLightmap;
uniform sampler2D uTileColor;
uniform bool uLightmapUse;
uniform int uSmoothLight; // 0 posterise, 1 raw, 2 pow 1.1

uniform vec3 uLightAmbient;
uniform vec3 uLightDiffuse;
uniform vec3 uLightEnv;

#include "fog.glsl"

vec3 posterize(vec3 c) {
	c *= 255.0;
	c = floor(c / 16.0) * 16.0;
	c /= 255.0;
	return c;
}

void main(void) {
	vec4 tex = texture(uDiffuse, vTextureCoord.st);
	if (tex.a < 0.1) {
		discard;
	}

	// Tile colour (R-MAP-007): rgba, alpha included, where the cell has a top tile.
	if (vTileColorCoord.st != vec2(0.0, 0.0)) {
		tex *= texture(uTileColor, vTileColorCoord.st);
	}

	vec3 color = (vLightWeighting * uLightDiffuse + uLightAmbient);
	tex.rgb *= clamp(color, 0.0, 1.0);
	tex.rgb *= clamp(uLightEnv, 0.0, 1.0);

	if (uLightmapUse) {
		vec4 lightmap = texture(uLightmap, vLightmapCoord.st);
		if (uSmoothLight == 0) {
			lightmap.rgb = posterize(lightmap.rgb);
		} else if (uSmoothLight == 2) {
			lightmap.rgb = pow(lightmap.rgb, vec3(1.1));
		}
		tex.rgb *= lightmap.a;
		tex.rgb += clamp(lightmap.rgb, 0.0, 1.0);
	}

	fragColor = applyFog(tex);
}
