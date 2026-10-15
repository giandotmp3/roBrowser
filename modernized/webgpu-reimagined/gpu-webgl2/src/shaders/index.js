import fog from './fog.glsl?raw';
import effectTexture from './effectTexture.glsl?raw';
import spriteVert from './sprite.vert?raw';
import spriteFrag from './sprite.frag?raw';
import groundFrag from './ground.frag?raw';
import waterFrag from './water.frag?raw';
import modelsFrag from './models.frag?raw';
import strVert from './str.vert?raw';
import strFrag from './str.frag?raw';
import gr2Vert from './gr2.vert?raw';
import gr2Frag from './gr2.frag?raw';
import occluderFade from './occluderFade.glsl?raw';
import groundVert from './world/ground.vert?raw';
import waterVert from './world/water.vert?raw';
import modelsVert from './world/models.vert?raw';
import animatedModelsVert from './world/animatedModels.vert?raw';
import gridVert from './world/grid.vert?raw';
import gridFrag from './world/grid.frag?raw';
import fxaaFrag from './fxaa.frag?raw';

const INCLUDES = Object.freeze({
	'fog.glsl': fog,
	'effectTexture.glsl': effectTexture,
	'occluderFade.glsl': occluderFade
});

/**
 * Resolve `#include "name"` lines. GLSL 300 es has no includes, so the shared
 * fog code (R-MAP-004) is spliced in at build time.
 * @param {string} src
 */
export function resolveIncludes(src) {
	return src.replace(/^#include "([^"]+)"\s*$/gm, (_, name) => {
		if (!(name in INCLUDES)) {
			throw new Error(`unknown include ${name}`);
		}
		return INCLUDES[name];
	});
}

/**
 * Insert `#define` lines right after the `#version` line.
 * @param {string} src
 * @param {ReadonlyArray<string>} defines
 */
export function withDefines(src, defines) {
	if (defines.length === 0) {
		return src;
	}
	return src.replace(/^(\s*#version[^\n]*\n)/, `$1${defines.map(d => `#define ${d}\n`).join('')}`);
}

export const SHADERS = Object.freeze({
	spriteVert,
	spriteFrag: resolveIncludes(spriteFrag),
	groundVert,
	groundFrag: resolveIncludes(groundFrag),
	waterVert,
	waterFrag: resolveIncludes(waterFrag),
	modelsVert,
	animatedModelsVert,
	modelsFrag: resolveIncludes(modelsFrag),
	gridVert,
	gridFrag: resolveIncludes(gridFrag),
	strVert,
	strFrag: resolveIncludes(strFrag),
	gr2Vert,
	gr2Frag: resolveIncludes(gr2Frag),
	fxaaFrag
});
