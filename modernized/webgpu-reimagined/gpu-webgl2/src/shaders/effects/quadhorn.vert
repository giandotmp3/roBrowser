#version 300 es
// quadhorn: legacy QuadHorn.vs. iPosition = (uPosition, uHeight), iOffset = (uOffsetX,
// uOffsetY, uOffsetZ, uBottomSize); iRotX/Y/Z = the 3x3 blocks of the three rotation
// matrices, built on the CPU exactly as legacy gl-matrix builds them (column-major, the
// fourth row and column are the identity's).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

mat4 rotation(vec3 c0, vec3 c1, vec3 c2) {
    return mat4(vec4(c0, 0.0), vec4(c1, 0.0), vec4(c2, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
}

void main(void) {
    mat4 uXRotationMat = rotation(iRotX0, iRotX1, iRotX2);
    mat4 uYRotationMat = rotation(iRotY0, iRotY1, iRotY2);
    mat4 uZRotationMat = rotation(iRotZ0, iRotZ1, iRotZ2);
    float uHeight = iPosition.w;
    vec4 position       = vec4(iPosition.x + iOffset.x, -iPosition.z - ((uHeight * 0.9) + iOffset.z), iPosition.y + iOffset.y, 1.0);
    position            += vec4(aPosition.x * iOffset.w, aPosition.y * uHeight, aPosition.z * iOffset.w, 0.0) * uXRotationMat * uYRotationMat * uZRotationMat;
    gl_Position         = uProjectionMat * uModelViewMat * position;

    vTextureCoord = aTextureCoord;
    vColor = iColor;
    vTex = iTex;
    vFog = iMisc.x;
}
