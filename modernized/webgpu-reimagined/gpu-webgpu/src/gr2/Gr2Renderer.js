import { NotImplementedError } from '../errors.js';

/**
 * GR2 draw side (C-14). Poses come from render-records (GR2Pose); bones are
 * uploaded to a storage buffer guarded by maxStorageBufferBindingSize (NFR-08).
 */
export class Gr2Renderer {
	constructor(deps) {
		this._deps = deps;
	}

	encode(_pass, _instances) {
		throw new NotImplementedError('Gr2Renderer.encode (C-14)');
	}
}
