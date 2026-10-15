import fog from './fog.glsl?raw';
import spriteVert from './sprite.vert?raw';
import spriteFrag from './sprite.frag?raw';
import groundFrag from './ground.frag?raw';
import waterFrag from './water.frag?raw';
import modelsFrag from './models.frag?raw';
import strFrag from './str.frag?raw';
import gr2Frag from './gr2.frag?raw';

const INCLUDES = Object.freeze({ 'fog.glsl': fog });

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

export const SHADERS = Object.freeze({
	spriteVert,
	spriteFrag: resolveIncludes(spriteFrag),
	groundFrag: resolveIncludes(groundFrag),
	waterFrag: resolveIncludes(waterFrag),
	modelsFrag: resolveIncludes(modelsFrag),
	strFrag: resolveIncludes(strFrag),
	gr2Frag
});
