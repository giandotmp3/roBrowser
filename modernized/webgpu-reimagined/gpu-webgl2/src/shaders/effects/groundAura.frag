#version 300 es
// groundAura: legacy GroundAura.fs (no fog: legacy uploads the fog uniforms, the shader
// declares none).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

in vec2 vTextureCoord;
flat in vec4 vColor;
flat in vec4 vTex;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	vec4 texColor = effectTexture(vTex, vTextureCoord);

	if (texColor.a < 0.01) {
		discard;
	}

	fragColor = texColor * vColor;
}
