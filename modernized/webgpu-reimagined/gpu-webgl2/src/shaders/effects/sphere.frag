#version 300 es
// spirit-sphere / warlock-sphere: legacy SpiritSphere.fs (texture x colour, no discard,
// no fog).
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
    vec4 textureSample = effectTexture(vTex, vTextureCoord.st);

    textureSample *= vColor;

    fragColor = textureSample;
}
