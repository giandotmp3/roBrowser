#version 300 es
// Instanced STR layer quad (run batching): one instance per STR EffectDraw record.
// Reproduces legacy Renderer/Effects/StrEffect.vs operation for operation; the
// per-draw uniforms became per-instance attributes. No per-vertex buffer: the
// strip vertex (gl_VertexID 0..3) picks its keyframe corner and its uv.
// R-EFX-009 billboard: 1/35 world unit per px, pivot offset, Y lowered (yLower),
// clip z biased by clipZBias (-0.1). #40: keyframe uv ignored, full texture.
precision highp float;

layout(location = 0) in vec3 aPosition;   // effect position (world)
layout(location = 1) in vec4 aQuadX;      // corner x (sprite px, x scale) in strip order v0..v3
layout(location = 2) in vec4 aQuadY;      // corner y
layout(location = 3) in vec2 aRotation;   // (cos, sin) of -angle, as legacy mat4.rotateZ
layout(location = 4) in vec2 aOffset;     // pos - pivot (+ attachment offset), sprite px
layout(location = 5) in vec4 aColor;
layout(location = 6) in vec3 aStr;        // x: yLower, y: clip z bias, z: fog (R-EFX-010 fix)
layout(location = 7) in vec4 aTex;        // x: array layer (-1 miss), y: POT class, zw: texture size / class size

uniform mat4 uModelView;
uniform mat4 uProjection;

out vec2 vUv;
flat out vec4 vColor;
flat out vec4 vTex;
flat out float vFog;

const float pixelRatio = 1.0 / 35.0;

// Legacy Project(): translate to (x, -z, y) + half a cell, then a spherical billboard.
mat4 Project(mat4 mat, vec3 pos) {
	float x = pos.x + 0.5;
	float y = -pos.z;
	float z = pos.y + 0.5;

	mat[3].x += mat[0].x * x + mat[1].x * y + mat[2].x * z;
	mat[3].y += mat[0].y * x + mat[1].y * y + mat[2].y * z;
	mat[3].z += mat[0].z * x + mat[1].z * y + mat[2].z * z;
	mat[3].w += mat[0].w * x + mat[1].w * y + mat[2].w * z;

	mat[0].xyz = vec3(1.0, 0.0, 0.0);
	mat[1].xyz = vec3(0.0, 1.0, 0.0);
	mat[2].xyz = vec3(0.0, 0.0, 1.0);

	return mat;
}

void main(void) {
	// Legacy strip: v0 uv(0,0), v1 uv(1,0), v2 uv(0,1), v3 uv(1,1).
	int id = gl_VertexID;
	vUv = vec2(float(id & 1), float(id >> 1));

	mat4 angle = mat4(
		aRotation.x, aRotation.y, 0.0, 0.0,
		-aRotation.y, aRotation.x, 0.0, 0.0,
		0.0, 0.0, 1.0, 0.0,
		0.0, 0.0, 0.0, 1.0
	);
	vec2 corner = vec2(aQuadX[id], aQuadY[id]);

	vec4 position = angle * vec4(corner.x * pixelRatio, -corner.y * pixelRatio, 0.0, 1.0);
	position.x += aOffset.x * pixelRatio;
	position.y -= aOffset.y * pixelRatio + aStr.x;

	gl_Position = uProjection * Project(uModelView, aPosition) * position;
	gl_Position.z += aStr.y;

	vColor = aColor;
	vTex = aTex;
	vFog = aStr.z;
}
