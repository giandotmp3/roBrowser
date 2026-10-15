#version 300 es
// rainPuddle: legacy RainWeather.fs (procedural ripples, fresnel, sky reflection).
precision highp float;
precision highp int;

#include "effectTexture.glsl"

uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

in vec2 vTextureCoord;
in vec3 vWorldPos;
flat in vec4 vColor;
flat in vec4 vShape;
flat in vec3 vCamera;
flat in vec4 vTex;
out vec4 fragColor;

void main(void) {
	if (vTex.x < 0.0) {
		discard;
	}
	float uTime = vShape.z;
	vec3 uCameraPos = vCamera;
	vec2 uv = vTextureCoord;
	vec2 center = vec2(0.5, 0.5);
	float dist = distance(uv, center);

	// Multi-layered procedural ripples - made slower for "standing water" look
	float wave1 = sin(dist * 20.0 - uTime * 2.2) * 0.5 + 0.5;
	float wave2 = sin(dist * 12.0 + uTime * 1.4 + vWorldPos.x * 0.5) * 0.5 + 0.5;
	float combinedWave = (wave1 * 0.7 + wave2 * 0.3) * (1.0 - dist * 2.0);

	// Distort UV based on waves for a "refraction" feel
	vec2 distortedUV = uv + (uv - center) * combinedWave * 0.035;
	vec4 texColor = effectTexture(vTex, distortedUV);

	if (texColor.a < 0.01) {
		discard;
	}

	// Fresnel Effect: Water reflects more at shallow angles
	vec3 viewDir = normalize(uCameraPos - vWorldPos);
	float fresnel = pow(1.0 - max(0.0, dot(viewDir, vec3(0.0, 1.0, 0.0))), 3.5);

	// Fake sky reflection (Bright Platinum mix)
	vec3 skyReflect = vec3(0.88, 0.92, 1.0);
	float reflectFactor = (pow(combinedWave, 2.5) * 0.45 + fresnel * 0.5) * 0.8;

	// Brighter deep water tone
	texColor.rgb *= 0.98;
	texColor.rgb = mix(texColor.rgb, skyReflect, reflectFactor);

	// Dynamic specular highlight (shine) on wave peaks
	float shine = pow(combinedWave, 8.0) * 0.55 + fresnel * 0.1;
	texColor.rgb += vec3(shine);

	// Final color with alpha from uColor
	vec4 finalColor = texColor * vColor;

	// Apply Fog
	if (vShape.w > 0.5) {
		float depth = gl_FragCoord.z / gl_FragCoord.w;
		float fogFactor = smoothstep(uFogNear, uFogFar, depth);
		finalColor.rgb = mix(finalColor.rgb, uFogColor, fogFactor);
	}

	fragColor = finalColor;
}
