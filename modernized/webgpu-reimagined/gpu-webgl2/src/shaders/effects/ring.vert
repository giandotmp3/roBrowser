#version 300 es
// Ground rings (families property-ground, magic-ring): legacy PropertyGround.vs and
// MagicRing.vs are the same program. iShape = (uTopSize, uBottomSize, uHeight, alpha),
// iRotation0..3 = uRotationMat columns.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec2 vShade;
flat out vec4 vTex;

void main(void) {
    float size, height;
    mat4 uRotationMat = mat4(iRotation0, iRotation1, iRotation2, iRotation3);

    if (aPosition.z == 1.0) {
        size   = iShape.x;
        height = iShape.z;
    }
    else {
        size   = iShape.y;
        height = 0.0;
    }

    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z - height, iPosition.y + 0.5, 1.0);
    position      += vec4(aPosition.x * size, 0.0, aPosition.y * size, 0.0) * uRotationMat;

    gl_Position    = uProjectionMat * uModelViewMat * position;
    vTextureCoord  = aTextureCoord;
    vShade = vec2(iShape.w, iPosition.w);
    vTex = iTex;
}
