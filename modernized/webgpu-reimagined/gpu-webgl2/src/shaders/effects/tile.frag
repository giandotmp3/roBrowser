#version 300 es
// Ground tiles. Legacy Tiles.fs (flat/hovering: any channel < 0.1 discarded, alpha from
// the record, scene fog) and LPEffect.fs / SpiderWeb.fs (any channel < 0.5 discarded,
// alpha 0.7, no fog) differ only in those values: vShade = (threshold, alpha, fog).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in vec4 vShade;
flat in vec4 vTex;
out vec4 fragColor;

void main(void) {
    if (vTex.x < 0.0) {
        discard;
    }
    vec4 textureSample = effectTexture(vTex, vTextureCoord.st);
    if (textureSample.r < vShade.x || textureSample.g < vShade.x || textureSample.b < vShade.x) {
        discard;
    }
    textureSample.a = vShade.y;
    fragColor = textureSample;

    if (vShade.z > 0.5) {
        float depth     = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep( uFogNear, uFogFar, depth );
        fragColor    = mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
    }
}
