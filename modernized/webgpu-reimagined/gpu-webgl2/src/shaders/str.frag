#version 300 es
// R-EFX-009 discard; R-EFX-010 (fixed) fog via shared include.
precision highp float;
uniform sampler2D uTexture;
uniform vec4 uColor;
in vec2 vUv;
out vec4 fragColor;

#include "fog.glsl"

void main() {
	vec4 tex = texture(uTexture, vUv);
	if (tex.a == 0.0 || (tex.r == 0.0 && tex.g == 0.0 && tex.b == 0.0)) { discard; }
	fragColor = applyFog(tex * uColor);
}
