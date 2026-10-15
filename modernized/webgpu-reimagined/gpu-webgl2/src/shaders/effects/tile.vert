#version 300 es
// Ground tiles (families flat-texture, hovering-texture, lp, spider-web): legacy Tiles.vs,
// LPEffect.vs and SpiderWeb.vs are the same program. Operation for operation; the per-draw
// uniforms became per-instance attributes (uPosition, uSize -> iPosition).
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec2 vTextureCoord;
flat out vec4 vShade;
flat out vec4 vTex;

void main(void) {
    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z, iPosition.y + 0.5, 1.0);
    position      += vec4(aPosition.x * iPosition.w, 0.0, aPosition.y * iPosition.w, 0.0);
    gl_Position    = uProjectionMat * uModelViewMat * position;
    gl_Position.z -= 0.01;
    vTextureCoord  = aTextureCoord;
    vShade = iShade;
    vTex = iTex;
}
