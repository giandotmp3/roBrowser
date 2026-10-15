import { CONTEXT_LOST_OVERLAY, PURGE_ON_LOSS_EXTENSIONS } from '../constants.js';
import { NotImplementedError } from '../errors.js';

/**
 * Device-loss handling (R-CTX-006) and rebuild (R-CTX-007, architecture §2.2 "Device loss").
 *
 * WebGPU has no "restored" event, so rebuild is driven by us:
 *   1. show overlay   2. request new adapter+device   3. reconfigure main canvas and live previews
 *   4. re-run setMap(currentMap)   5. no adapter -> switch to gpu-webgl2 mid-session
 */
export class DeviceLossController {
	/**
	 * @param {{
	 *   overlay: import('../ports.js').OverlayPort,
	 *   assets: import('../ports.js').AssetCachePort,
	 *   scene: import('../ports.js').ScenePort,
	 *   fallback: import('../ports.js').FallbackPort,
	 *   createDevice: () => Promise<import('./RenderDevice.js').RenderDevice>,
	 *   previews?: { reconfigureAll(device: any): void },
	 *   residency?: { reset(device: any): void },
	 *   postChain?: { rebuild(device: any): void }
	 * }} deps
	 */
	constructor(deps) {
		this._deps = deps;
		this.rendering = true;
		this.lost = false;
	}

	/** R-CTX-006: stop rendering, purge cached image/sprite data, show overlay. */
	onLost() {
		this.lost = true;
		this.rendering = false;
		this._deps.assets.purge(PURGE_ON_LOSS_EXTENSIONS);
		this._deps.overlay.show({ ...CONTEXT_LOST_OVERLAY });
	}

	/** R-CTX-006: resize is ignored while the device is lost. */
	shouldHandleResize() {
		return !this.lost;
	}

	/**
	 * R-CTX-007 rebuild sequence. Must hide the overlay, reapply default
	 * pipeline state (new PipelineSet), rebuild post-process targets,
	 * reconfigure previews, re-run setMap(currentMap) (fixes legacy restore,
	 * which never rebuilt the map) and resume rendering; on no adapter it
	 * calls fallback.switchToWebgl2().
	 * @returns {Promise<'webgpu'|'webgl2'>}
	 */
	async rebuild() {
		throw new NotImplementedError('DeviceLossController.rebuild (R-CTX-007)');
	}
}
