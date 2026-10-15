import { NotImplementedError } from '../errors.js';

/**
 * Per-map GPU scene (MapScene in spec §2.1). Consumes the MAP_* worker
 * messages (spec §3.2; buffers arrive as transferables, images as ImageBitmap)
 * and owns ground, water, static/animated RSM, clouds and grid resources.
 * Retains the CPU payloads of the current map so device loss can rebuild
 * without re-parsing (architecture §4 item 3).
 */
export class MapGpuScene {
	/**
	 * @param {{device: GPUDevice, residency: import('../residency/Residency.js').Residency, pipelines: import('../pipelines/PipelineSet.js').PipelineSet}} deps
	 */
	constructor(deps) {
		this._deps = deps;
		this.mapName = null;
		/** @type {Record<string, any>} retained CPU payloads */
		this.payloads = {};
	}

	/** Drop stale messages (load request mismatch) and dispatch to the uploaders. */
	onWorkerMessage(msg, currentRequest) {
		if (msg.request !== currentRequest) {
			return false;
		}
		this.payloads[msg.type] = msg.payload;
		return true;
	}

	uploadGround(_payload) {
		throw new NotImplementedError('MapGpuScene.uploadGround (C-03)');
	}

	uploadWater(_payload) {
		throw new NotImplementedError('MapGpuScene.uploadWater (C-04)');
	}

	uploadModels(_payload) {
		throw new NotImplementedError('MapGpuScene.uploadModels (C-05)');
	}

	uploadAnimatedModel(_payload) {
		throw new NotImplementedError('MapGpuScene.uploadAnimatedModel (C-05)');
	}

	/** Re-upload from retained payloads after device loss (R-CTX-007). */
	rebuild(_device) {
		throw new NotImplementedError('MapGpuScene.rebuild (R-CTX-007)');
	}

	free() {
		this.payloads = {};
		this.mapName = null;
	}
}
