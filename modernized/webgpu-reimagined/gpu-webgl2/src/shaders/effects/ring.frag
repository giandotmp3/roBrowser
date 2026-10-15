#version 300 es
// Ground rings: legacy PropertyGround.fs (alpha 0.42) and MagicRing.fs (alpha 0.7); the
// forced alpha comes from the record colour. vShade = (alpha, fog).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in vec2 vShade;
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

    if (textureSample.r < 0.5 || textureSample.g < 0.5 || textureSample.b < 0.5) {
        discard;
    }
    textureSample.a = vShade.x;
    fragColor = textureSample;

    if (vShade.y > 0.5) {
        float depth     = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep( uFogNear, uFogFar, depth );
        fragColor    = mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
    }
}
