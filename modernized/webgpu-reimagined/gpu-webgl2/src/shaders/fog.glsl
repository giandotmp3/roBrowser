// R-MAP-004: shared fog include (ground, sprite, model, STR, effect shaders).
// f = smoothstep(near, far, z/w); rgb = mix(rgb, fogColor, f); alpha preserved.
uniform bool uFogUse;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

vec4 applyFog(vec4 color) {
	if (!uFogUse) {
		return color;
	}
	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float f = smoothstep(uFogNear, uFogFar, depth);
	return vec4(mix(color.rgb, uFogColor, f), color.a);
}
