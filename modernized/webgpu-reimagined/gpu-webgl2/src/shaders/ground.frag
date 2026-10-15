#version 300 es
// R-MAP-001/002/003 ground shading; R-MAP-004 fog.
precision highp float;

uniform sampler2D uDiffuse;
uniform sampler2D uLightmap;
uniform sampler2D uTileColor;
uniform bool uLightmapUse;
uniform int uSmoothLight;   // 0 posterise, 1 raw, 2 pow 1.1
uniform vec3 uLightDir;
uniform vec3 uDiffuseLight;
uniform vec3 uAmbient;
uniform vec3 uEnv;

in vec2 vUv;
in vec2 vLmUv;
in vec2 vTcUv;
in vec3 vNormal;
out vec4 fragColor;

#include "fog.glsl"

void main() {
	vec4 tex = texture(uDiffuse, vUv);
	if (tex.a < 0.1) { discard; }
	vec3 c = tex.rgb;
	if (vTcUv.x != 0.0 || vTcUv.y != 0.0) { c *= texture(uTileColor, vTcUv).rgb; }
	float nl = max(dot(vNormal, uLightDir), 0.0);
	c *= clamp(nl * uDiffuseLight + uAmbient, 0.0, 1.0);
	c *= clamp(uEnv, 0.0, 1.0);
	if (uLightmapUse) {
		vec4 lm = texture(uLightmap, vLmUv);
		vec3 lc = lm.rgb;
		if (uSmoothLight == 0) { lc = floor(lc * 255.0 / 16.0) * 16.0 / 255.0; }
		else if (uSmoothLight == 2) { lc = pow(lc, vec3(1.1)); }
		c = c * lm.a + clamp(lc, 0.0, 1.0);
	}
	fragColor = applyFog(vec4(c, tex.a));
}
