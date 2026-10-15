#version 300 es
// spirit-sphere / warlock-sphere: legacy SpiritSphere.vs = WarlockSphere.vs.
// iPosition = (uPosition, uSize), iDepth = (uZIndex, uCameraZoom), iTexRot0..3 =
// uTextureRotMat columns, iRotation0..3 = uRotationMat columns.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vColor;
flat out vec4 vTex;

void main(void) {
    mat4 uTextureRotMat = mat4(iTexRot0, iTexRot1, iTexRot2, iTexRot3);
    mat4 uRotationMat = mat4(iRotation0, iRotation1, iRotation2, iRotation3);

    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z - 2.0, iPosition.y + 0.5, 1.0);

    vec4 pos2      = vec4(aPosition.x * iPosition.w, 0.0, aPosition.y * iPosition.w, 0.0) * uTextureRotMat;
    pos2.x        += 1.0;
    position      += pos2 * uRotationMat;

    gl_Position    = uProjectionMat * uModelViewMat * position;
    gl_Position.z -= iDepth.x / max(iDepth.y, 1.0);

    vTextureCoord  = aTextureCoord;
    vColor = iColor;
    vTex = iTex;
}
