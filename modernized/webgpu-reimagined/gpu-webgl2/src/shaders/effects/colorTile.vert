#version 300 es
// flat-color-tile: legacy FlatColorTile.vs. The colour stays a smooth varying, as legacy
// passes uColor through one.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;

out vec4 vColor;

void main(void) {
    vec4 position  = vec4(iPosition.x + 0.5, -iPosition.z, iPosition.y + 0.5, 1.0);
    position      += vec4(aPosition.x * iPosition.w, 0.0, aPosition.y * iPosition.w, 0.0);

    gl_Position    = uProjectionMat * uModelViewMat * position;
    gl_Position.z -= 0.01;
    vColor = iColor;
}
