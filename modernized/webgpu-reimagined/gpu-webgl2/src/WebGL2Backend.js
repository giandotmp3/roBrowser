import { GLDevice } from './device/GLDevice.js';
import { ContextLossController } from './device/ContextLossController.js';
import { onRenderError } from './device/frameErrorPolicy.js';
import { GLStateCache } from './pipeline/GLStateCache.js';
import { Residency } from './residency/Residency.js';
import { TextureArrayPools } from './residency/TextureArrayPools.js';
import { RunRenderer } from './batching/RunRenderer.js';
import { PostChain } from './post/PostChain.js';
import { runMapFrame } from './frame/passOrder.js';
import { NotImplementedError } from './errors.js';

/**
 * gpu-webgl2 backend facade. Same backend contract as gpu-webgpu:
 *
 *   kind, init(), resize(w, h), drawFrame(frame), acceptMapMessage(msg),
 *   capture(), handleRenderError(), dispose()
 *
 * It consumes the ordered record stream from render-records and owns no
 * rendering rules beyond the GPU side.
 */
export class WebGL2Backend {
	/**
	 * @param {{
	 *   canvas: import('./ports.js').CanvasPort,
	 *   overlay: import('./ports.js').OverlayPort,
	 *   assets: import('./ports.js').AssetCachePort,
	 *   settings: import('./ports.js').SettingsPort,
	 *   scene: import('./ports.js').ScenePort & {rebuildMap(): void},
	 *   now: () => number,
	 *   uploader?: ConstructorParameters<typeof Residency>[0]['uploader'],
	 *   postTargets?: ConstructorParameters<typeof PostChain>[0]['targets']
	 * }} ports
	 */
	constructor(ports) {
		this.kind = 'webgl2';
		this._ports = ports;
		this.device = new GLDevice({ canvas: ports.canvas });
		this.running = false;
		this.state = null;
		this.residency = null;
		this.runs = null;
		this.post = new PostChain({ targets: ports.postTargets ?? { resize() {}, reinit() {} } });
		this.loss = null;
		this._size = { width: ports.canvas.width, height: ports.canvas.height };
	}

	/** R-CTX-001/002, then wire R-CTX-006/007. */
	init() {
		const gl = this.device.init();
		this.state = new GLStateCache(gl);
		this.residency = new Residency({
			uploader: this._ports.uploader ?? new TextureArrayPools({ gl }),
			now: this._ports.now
		});
		this.runs = new RunRenderer({ gl, state: this.state, residency: this.residency });
		this.loss = new ContextLossController({
			canvas: this._ports.canvas,
			getGl: () => this.device.gl,
			overlay: this._ports.overlay,
			assets: this._ports.assets,
			onLost: () => {
				this.running = false;
				this.residency.purgeAll();
				this.runs.sprites.reset();
				this.state.reset();
			},
			reinitPost: () => this.post.reinit(),
			resize: () => this.resize(this._size.width, this._size.height),
			rebuildMap: () => this._ports.scene.rebuildMap(),
			resume: () => {
				this.running = true;
			}
		});
		this.loss.attach();
		this.running = true;
		return this;
	}

	/** Backing-store sizing is computed by scene (R-CTX-008); this resizes GPU targets. */
	resize(width, height) {
		this._size = { width, height };
		if (this.loss?.shouldIgnoreResize()) {
			return false;
		}
		this.post.resize(width, height);
		return true;
	}

	/**
	 * Draw one frame in R-CTX-010 order.
	 * @param {{passes: Record<string, ReadonlyArray<import('./ports.js').DrawRecord>>, view?: import('./sprites/SpritePipeline.js').SpriteView}} frame
	 *   Records per GPU step, each in legacy order; `view` carries the camera matrices, zoom and fog.
	 */
	drawFrame(frame) {
		if (!this.running) {
			return [];
		}
		const gpuPasses = {};
		for (const [name, records] of Object.entries(frame.passes ?? {})) {
			gpuPasses[name] = () => this.runs.draw(records, frame.view);
		}
		return runMapFrame(gpuPasses, this._ports.scene);
	}

	/** R-CTX-005 */
	handleRenderError() {
		return onRenderError({ contextLost: Boolean(this.loss?.lost), settings: this._ports.settings });
	}

	/**
	 * Map-streaming worker messages (§3.2): MAP_GROUND, MAP_MODELS,
	 * MAP_ANIMATED_MODEL, MAP_WORLD. Buffers arrive as transferables.
	 * @param {{type: string, payload: object}} _msg
	 */
	acceptMapMessage(_msg) {
		throw new NotImplementedError('acceptMapMessage (C-17 GPU upload)');
	}

	/** C-20: capture the composed frame (preserveDrawingBuffer path). */
	capture() {
		throw new NotImplementedError('capture (C-20)');
	}

	dispose() {
		this.running = false;
		this.residency?.uploader.dispose?.();
		this.residency?.purgeAll();
	}
}
