#version 300 es
// lock-on: legacy LockOnTarget.vs. iPosition = (uPosition, uSize), iRotation0..3 =
// uRotationMat columns, iMisc = (uColor shade, fog).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec2 vMisc;
flat out vec4 vTex;

void main(void) {
    mat4 uRotationMat = mat4(iRotation0, iRotation1, iRotation2, iRotation3);
    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z, iPosition.y + 0.5, 1.0);
    position      += vec4(aPosition.x * iPosition.w, 0.0, aPosition.y * iPosition.w, 0.0) * uRotationMat;

    gl_Position    = uProjectionMat * uModelViewMat * position;
    gl_Position.z -= 0.02;

    vTextureCoord  = aTextureCoord;
    vMisc = iMisc.xy;
    vTex = iTex;
}
