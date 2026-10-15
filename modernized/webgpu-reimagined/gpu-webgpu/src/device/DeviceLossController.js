import { CONTEXT_LOST_OVERLAY, PURGE_ON_LOSS_EXTENSIONS } from '../constants.js';

/**
 * Device-loss handling (R-CTX-006) and rebuild (R-CTX-007, architecture §2.2 "Device loss").
 *
 * WebGPU has no "restored" event, so the rebuild is driven from here, right after the loss:
 *   1. show the R-CTX-006 overlay (`onLost`)
 *   2. request a new adapter + device (`createDevice`: RenderDevice.init, which also
 *      reconfigures the main canvas on the new device)
 *   3. recreate every GPU object on it: pipelines (R-CTX-002 default state is baked into
 *      each new pipeline), post-process targets (R-CTX-007), the residency's GPU side
 *      (assets re-upload on demand through its FrameSourcePort), and reconfigure every
 *      live-preview context (the contexts registry)
 *   4. hide the overlay, re-run `setMap(currentMap)` (fixes legacy restore, which never
 *      rebuilt the map) and resume rendering
 *   5. if no device can be had, switch to gpu-webgl2 mid-session (`fallback.switchToWebgl2`),
 *      then re-run `setMap(currentMap)` there.
 *
 * Ports (all injected; the architecture's names in brackets):
 * - `createDevice` [requestAdapter]: resolves a RenderDevice-like `{device}` (or a GPUDevice);
 *   throws (DeviceUnavailableError / DeviceLimitError, or any error) when none can be had
 * - `overlay` [onOverlay]: show / hide
 * - `scene` [reloadMap]: `currentMap()` and `setMap(name)`
 * - `fallback` [fallbackToWebGL2]: `switchToWebgl2(reason)`
 * - `previews` [contexts registry]: `reconfigureAll(device)` (LivePreviews)
 * - `residency`: `purgeAll()` on loss, `reset(device)` on rebuild
 * - `pipelines`: `rebuild(device)`: every renderer of the scene pass, target and blit
 * - `postChain`: `rebuild(device)` (PostChain)
 * - `onDevice(renderDevice)`: the owner adopts the new device (e.g. watches its `lost`)
 */
export class DeviceLossController {
	/**
	 * @param {{
	 *   overlay: import('../ports.js').OverlayPort,
	 *   assets: import('../ports.js').AssetCachePort,
	 *   scene: import('../ports.js').ScenePort,
	 *   fallback: import('../ports.js').FallbackPort,
	 *   createDevice: () => Promise<import('./RenderDevice.js').RenderDevice|any>,
	 *   previews?: { reconfigureAll(device: any): void },
	 *   residency?: { purgeAll?(): void, reset?(device: any): void },
	 *   pipelines?: { rebuild(device: any): unknown },
	 *   postChain?: { rebuild(device: any): unknown },
	 *   onDevice?: (renderDevice: any) => void
	 * }} deps
	 */
	constructor(deps) {
		this._deps = deps;
		this.rendering = true;
		this.lost = false;
		/** 'webgpu' while this backend renders; 'webgl2' once it handed over to gpu-webgl2. */
		this.active = 'webgpu';
		/** Losses handled and rebuilds finished (diagnostics). */
		this.losses = 0;
		this.rebuilds = 0;
		/** @type {{reason: string, message: string}|null} */
		this.lastLoss = null;
		/** Why the last rebuild fell back to gpu-webgl2. */
		this.fallbackReason = null;
		/** @type {Promise<'webgpu'|'webgl2'>|null} */
		this._rebuilding = null;
	}

	/**
	 * R-CTX-006: stop rendering, purge cached image/sprite data (CPU cache and GPU
	 * residency), show the overlay. Idempotent while lost.
	 * @param {{reason?: string, message?: string}} [info]  GPUDeviceLostInfo
	 */
	onLost(info = {}) {
		if (this.lost) {
			return;
		}
		this.lost = true;
		this.rendering = false;
		this.losses++;
		this.lastLoss = { reason: info.reason ?? 'unknown', message: info.message ?? '' };
		this._deps.residency?.purgeAll?.();
		this._deps.assets.purge(PURGE_ON_LOSS_EXTENSIONS);
		this._deps.overlay.show({ ...CONTEXT_LOST_OVERLAY });
	}

	/** R-CTX-006: resize is ignored while the device is lost. */
	shouldHandleResize() {
		return !this.lost;
	}

	/**
	 * R-CTX-007 rebuild sequence (class comment). Concurrent calls share one rebuild.
	 * @returns {Promise<'webgpu'|'webgl2'>}
	 */
	rebuild() {
		this._rebuilding ??= this._rebuild().finally(() => {
			this._rebuilding = null;
		});
		return this._rebuilding;
	}

	async _rebuild() {
		const d = this._deps;
		let renderDevice;
		try {
			renderDevice = await d.createDevice();
		} catch (err) {
			return this._fallback(err);
		}
		const device = renderDevice?.device ?? renderDevice;
		d.onDevice?.(renderDevice);
		d.residency?.reset?.(device);
		await d.pipelines?.rebuild(device);
		await d.postChain?.rebuild(device);
		d.previews?.reconfigureAll(device);
		d.overlay.hide();
		this.lost = false;
		await this._reloadMap();
		this.rendering = true;
		this.rebuilds++;
		return 'webgpu';
	}

	async _fallback(err) {
		this.fallbackReason = String(err?.message ?? err);
		this.active = 'webgl2';
		await this._deps.fallback.switchToWebgl2(this.fallbackReason);
		this._deps.overlay.hide();
		this.lost = false;
		await this._reloadMap();
		// This backend stays stopped: gpu-webgl2 renders from now on.
		this.rendering = false;
		return 'webgl2';
	}

	async _reloadMap() {
		const map = this._deps.scene.currentMap?.() ?? null;
		if (map) {
			await this._deps.scene.setMap(map);
		}
	}
}
