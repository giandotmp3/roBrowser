import { CONTEXT_LOST_OVERLAY, PURGE_ON_LOSS_EXTENSIONS } from '../constants.js';
import { applyDefaultState } from './GLDevice.js';

/**
 * Context lost / restored handling (R-CTX-006, R-CTX-007).
 *
 * The rebuild also fixes the legacy restore, which never rebuilt the current
 * map (architecture §2.2 "Device loss"): on restore, GPU residency is empty, so
 * the map scene is rebuilt from the retained CPU payloads and assets re-upload
 * on demand.
 */
export class ContextLossController {
	/**
	 * @param {{
	 *   canvas: import('../ports.js').CanvasPort,
	 *   getGl: () => WebGL2RenderingContext,
	 *   overlay: import('../ports.js').OverlayPort,
	 *   assets: import('../ports.js').AssetCachePort,
	 *   onLost?: () => void,
	 *   reinitPost: () => void,
	 *   resize: () => void,
	 *   rebuildMap: () => void,
	 *   resume: () => void
	 * }} deps
	 */
	constructor(deps) {
		this._deps = deps;
		this.lost = false;
	}

	/** Wire the canvas events. */
	attach() {
		this._deps.canvas.addEventListener('webglcontextlost', ev => this.handleLost(ev));
		this._deps.canvas.addEventListener('webglcontextrestored', () => this.handleRestored());
	}

	/**
	 * R-CTX-006: prevent default (so the browser may restore), stop rendering,
	 * purge cached image/sprite/palette/STR data, show the overlay.
	 * @param {{preventDefault(): void}} ev
	 */
	handleLost(ev) {
		ev.preventDefault();
		this.lost = true;
		this._deps.onLost?.();
		this._deps.assets.purge(PURGE_ON_LOSS_EXTENSIONS);
		this._deps.overlay.show({ ...CONTEXT_LOST_OVERLAY });
	}

	/**
	 * R-CTX-007: hide overlay, reapply R-CTX-002 default state, re-init active
	 * post modules, resize framebuffers, rebuild the map (fix), resume.
	 */
	handleRestored() {
		this._deps.overlay.hide();
		applyDefaultState(this._deps.getGl());
		this._deps.reinitPost();
		this.lost = false;
		this._deps.resize();
		this._deps.rebuildMap();
		this._deps.resume();
	}

	/** R-CTX-006: resize is ignored while the context is lost. */
	shouldIgnoreResize() {
		return this.lost;
	}
}
