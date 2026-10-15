#version 300 es
// R-GR2-002 hard alpha test at 207/255; opaque output.
precision highp float;
uniform sampler2D uTexture;
uniform float uDiffuse;
uniform float uAmbient;
uniform vec3 uLightDir;
uniform float uFadeAlpha;
in vec2 vUv;
in vec3 vNormal;
out vec4 fragColor;

void main() {
	vec4 tex = texture(uTexture, vUv);
	if (tex.a < 207.0 / 255.0) { discard; }
	float l = clamp(max(dot(vNormal, uLightDir), 0.0) * uDiffuse + uAmbient, 0.0, 1.0);
	fragColor = vec4(tex.rgb * l, uFadeAlpha);
}
