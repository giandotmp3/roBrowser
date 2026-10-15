import { NotImplementedError } from '../errors.js';

/**
 * Per-family GPU renderers for EffectDraw records (STR, 2D, 3D, cylinder,
 * RSM, QuadHorn, auras, spheres, ground tiles, weather, screen tints).
 * Shared quad VB + instance buffers; no per-instance textures or buffers
 * (fixes the TwoD/ThreeD/Cylinder leaks, NFR-05).
 */
export class EffectRenderers {
	constructor(deps) {
		this._deps = deps;
	}

	encode(_pass, _records, _runs) {
		throw new NotImplementedError('EffectRenderers.encode (C-09)');
	}
}
