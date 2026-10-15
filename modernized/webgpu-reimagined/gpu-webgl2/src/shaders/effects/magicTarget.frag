#version 300 es
// magic-target: legacy MagicTarget.fs.
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in float vFog;
flat in vec4 vTex;
out vec4 fragColor;

void main(void) {
    if (vTex.x < 0.0) {
        discard;
    }
    vec4 textureSample = effectTexture(vTex, vTextureCoord.st);

    if (textureSample.a == 0.0) {
        discard;
    }

    if (textureSample.r < 0.1 || textureSample.g < 0.1 || textureSample.b < 0.1) {
        discard;
    }

    fragColor = textureSample;

    if (vFog > 0.5) {
        float depth     = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep( uFogNear, uFogFar, depth );
        fragColor    = mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
    }
}
