#version 300 es
// magic-target: legacy MagicTarget.vs over the ground plane of the record (per-record
// vertex data). iRotation0..3 = uRotationMat columns, iMisc = (uCameraLatitude, fog).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out float vFog;
flat out vec4 vTex;

void main(void) {
    mat4 uRotationMat = mat4(iRotation0, iRotation1, iRotation2, iRotation3);
    gl_Position    = uProjectionMat * uModelViewMat * vec4( aPosition, 1.0);
    gl_Position.z -= 0.02 / iMisc.x;

    vTextureCoord  = (uRotationMat * vec4( aTextureCoord - 0.5, 1.0, 1.0)).xy + 0.5;
    vFog = iMisc.y;
    vTex = iTex;
}
