// Mesh effect families: the effect texture is an rgba8 texture-array layer (residency).
// The image sits in the layer's top-left corner, edge-replicated, so LINEAR over
// uv * (size / class) equals legacy's per-texture LINEAR + CLAMP_TO_EDGE; a family whose
// legacy texture wraps (REPEAT) binds a REPEAT sampler for its run, exact when the image
// fills its layer (square power-of-two images).
// tex: x array layer (-1: not resident), y POT class index (32..512), zw image size / class size.
precision highp sampler2DArray;

uniform sampler2DArray uRgba[5];

vec4 effectTexture(vec4 tex, vec2 uv) {
	vec3 p = vec3(uv * tex.zw, tex.x);
	int c = int(tex.y);
	if (c == 0) {
		return textureLod(uRgba[0], p, 0.0);
	}
	if (c == 1) {
		return textureLod(uRgba[1], p, 0.0);
	}
	if (c == 2) {
		return textureLod(uRgba[2], p, 0.0);
	}
	if (c == 3) {
		return textureLod(uRgba[3], p, 0.0);
	}
	return textureLod(uRgba[4], p, 0.0);
}
