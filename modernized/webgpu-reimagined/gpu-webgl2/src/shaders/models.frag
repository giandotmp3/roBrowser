#version 300 es
// R-MAP-012 static and (R-MAP-013 fixed) animated RSM shading share this file.
precision highp float;
uniform sampler2D uDiffuse;
uniform bool uLightmapUse;
uniform vec3 uLightDir;
uniform vec3 uDiffuseLight;
uniform vec3 uAmbient;
uniform vec3 uEnv;
in vec2 vUv;
in vec3 vNormal;
in float vAlpha;
out vec4 fragColor;

#include "fog.glsl"

void main() {
	vec4 tex = texture(uDiffuse, vUv);
	if (tex.a == 0.0) { discard; }
	float nl = uLightmapUse ? max(dot(vNormal, uLightDir), 0.0) : 1.0;
	vec3 c = tex.rgb * clamp(nl * uDiffuseLight + uAmbient, 0.0, 1.0) * clamp(uEnv, 0.0, 1.0);
	fragColor = applyFog(vec4(c, tex.a * vAlpha));
}
