#version 300 es
// cylinder: legacy Cylinder.vs. iPosition = (uPosition, uZindex), iShape = (uTopSize,
// uBottomSize, uHeight, uRotate), iRotation0..3 = uRotationMat columns.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

void main(void) {
    float size, height;
    mat4 uRotationMat = mat4(iRotation0, iRotation1, iRotation2, iRotation3);

    if (aPosition.z == 1.0) {
        size   = iShape.x;
        height = iShape.z;
    } else {
        size   = iShape.y;
        height = 0.0;
    }

    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z, iPosition.y + 0.5, 1.0);
    if(iShape.w > 0.5) {
        position += vec4(aPosition.x * size, -height, aPosition.y * size, 0.0) * uRotationMat;
    } else {
        position  += vec4(aPosition.x * size, -height, aPosition.y * size, 0.0);
    }

    gl_Position    = uProjectionMat * uModelViewMat * position;
    gl_Position.z -= iPosition.w;

    vTextureCoord  = aTextureCoord;
    vColor = iColor;
    vTex = iTex;
    vFog = iMisc.x;
}
