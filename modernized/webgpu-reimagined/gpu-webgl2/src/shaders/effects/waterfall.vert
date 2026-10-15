#version 300 es
// waterfall (curtain segment): legacy WaterfallEffect.vs. One instance per record, a
// 4-vertex strip whose corners come from the record vertices (iCornerX/Y/Z/U/V hold
// corner k in component k); iModel0..3 = uModelMat columns.
precision highp float;

#pragma attributes

uniform mat4 uModelViewMat;
uniform mat4 uProjectionMat;
out vec2 vTextureCoord;
flat out vec4 vMisc;
flat out vec4 vTex;

void main(void) {
	mat4 uModelMat = mat4(iModel0, iModel1, iModel2, iModel3);
	int k = gl_VertexID;
	vec3 aPosition = vec3(iCornerX[k], iCornerY[k], iCornerZ[k]);
	vec2 aTextureCoord = vec2(iCornerU[k], iCornerV[k]);
	vec4 worldPosition = uModelMat * vec4(aPosition.x, -aPosition.y, aPosition.z, 1.0);
	gl_Position = uProjectionMat * uModelViewMat * worldPosition;
	vTextureCoord = aTextureCoord;
	vMisc = iMisc;
	vTex = iTex;
}
