#version 300 es
// lock-on: legacy LockOnTarget.fs (green and blue scaled by the shade).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in vec2 vMisc;
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

    fragColor     = textureSample;
    fragColor.gb *= vMisc.x;

    if (vMisc.y > 0.5) {
        float depth     = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep( uFogNear, uFogFar, depth );
        fragColor    = mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
    }
}
