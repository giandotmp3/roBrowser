#version 300 es
// quadhorn: legacy QuadHorn.fs.
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogColor;

in vec2 vTextureCoord;
flat in vec4 vColor;
flat in vec4 vTex;
flat in float vFog;
out vec4 fragColor;

void main(void) {
    if (vTex.x < 0.0) {
        discard;
    }

    vec4 textureSample = effectTexture(vTex, vTextureCoord.st);

    if (textureSample.a == 0.0 ) { discard; }
    if (textureSample.r < 0.01 && textureSample.g < 0.01 && textureSample.b < 0.01) {
        discard;
        }

    fragColor = textureSample * vColor;

    if (vFog > 0.5) {
        float depth     = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = smoothstep( uFogNear, uFogFar, depth );
        fragColor    = mix( fragColor, vec4( uFogColor, fragColor.w ), fogFactor );
    }
}
