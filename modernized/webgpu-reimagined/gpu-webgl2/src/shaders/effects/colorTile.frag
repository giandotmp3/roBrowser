#version 300 es
// flat-color-tile: legacy FlatColorTile.fs (no texture, no fog).
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main(void) {
    fragColor = vColor;
}
