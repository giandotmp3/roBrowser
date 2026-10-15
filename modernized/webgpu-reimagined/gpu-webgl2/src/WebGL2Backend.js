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
import { GL } from './pipeline/glEnums.js';
import { MapWorld } from './world/MapWorld.js';
import { clearColorFor } from './world/lighting.js';
import { Gr2Residency } from './gr2/Gr2Residency.js';
import { Gr2Pipeline } from './gr2/Gr2Pipeline.js';

/** R-CTX-010 steps whose world part this backend draws from the MAP_* payloads. */
const WORLD_STEPS = Object.freeze([
	'postPrepare',
	'ground',
	'groundPickAndGridSelector',
	'occluderFadeBegin',
	'staticModels',
	'animatedModels',
	'water',
	'fadedModels'
]);

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
	 *   frames?: import('./residency/Residency.js').FrameSourcePort,
	 *   gr2?: import('./gr2/Gr2Residency.js').Gr2SourcePort,
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
		/** @type {MapWorld|null} */
		this.world = null;
		/** @type {Gr2Residency|null} */
		this.gr2Residency = null;
		/** @type {Gr2Pipeline|null} */
		this.gr2 = null;
		this._mapRequest = undefined;
		this._size = { width: ports.canvas.width, height: ports.canvas.height };
	}

	/** R-CTX-001/002, then wire R-CTX-006/007. */
	init() {
		const gl = this.device.init();
		this.state = new GLStateCache(gl);
		this.residency = new Residency({
			uploader: this._ports.uploader ?? new TextureArrayPools({ gl }),
			now: this._ports.now,
			source: this._ports.frames ?? null
		});
		this.runs = new RunRenderer({ gl, state: this.state, residency: this.residency });
		this.world = new MapWorld({
			gl,
			state: this.state,
			images: this._ports.images,
			files: this._ports.files,
			createCanvas: this._ports.createCanvas,
			mipmaps: Boolean(this._ports.settings?.get?.('enableMipmap'))
		});
		this.gr2Residency = new Gr2Residency({
			gl,
			source: this._ports.gr2 ?? null,
			createCanvas: this._ports.createCanvas,
			now: this._ports.now
		});
		this.gr2 = new Gr2Pipeline({ gl, state: this.state, residency: this.gr2Residency });
		this.loss = new ContextLossController({
			canvas: this._ports.canvas,
			getGl: () => this.device.gl,
			overlay: this._ports.overlay,
			assets: this._ports.assets,
			onLost: () => {
				this.running = false;
				this.residency.purgeAll();
				this.runs.reset();
				this.state.reset();
				this.world.contextLost();
				this.gr2Residency.purgeAll();
				this.gr2.reset();
			},
			reinitPost: () => this.post.reinit(),
			resize: () => this.resize(this._size.width, this._size.height),
			rebuildMap: () => {
				// R-CTX-007 fix: the map comes back from the retained MAP_* payloads.
				this.world.rebuild();
				this._ports.scene.rebuildMap();
			},
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
	 *
	 * The world steps (ground, grid selector, occluder-fade begin, static and animated
	 * RSM, water, faded models) draw the current map's MAP_* payloads first, then the
	 * step's records. `world` records steer them: a `water` record supplies the
	 * R-MAP-010 alpha, the R-MAP-009 frame and the depth state; an `animatedModel`
	 * record with `matrices` (and `params.model`, the model's load index) replaces the
	 * local R-MAP-016/017 matrices of that model.
	 * @param {{
	 *   passes: Record<string, ReadonlyArray<import('./ports.js').DrawRecord>>,
	 *   view?: import('./sprites/SpritePipeline.js').SpriteView,
	 *   world?: import('./world/MapWorld.js').WorldFrame & {sky?: {skyColor: number[]}|null}
	 * }} frame
	 *   Records per GPU step, each in legacy order; `view` carries the camera matrices, zoom
	 *   and fog; `world` the per-frame world inputs (`sky` present: clear to its colour,
	 *   R-CTX-009, at post-process prepare).
	 */
	drawFrame(frame) {
		if (!this.running) {
			return [];
		}
		this.residency.beginFrame();
		const passes = frame.passes ?? {};
		const gpuPasses = {};
		for (const [name, records] of Object.entries(passes)) {
			gpuPasses[name] = () => this.runs.draw(records, frame.view);
		}
		if (frame.view) {
			const gr2Records = passes.gr2Models ?? [];
			gpuPasses.gr2Models = () => this._drawGr2(frame, gr2Records);
			for (const step of WORLD_STEPS) {
				const records = passes[step] ?? [];
				gpuPasses[step] = () => {
					this._drawWorldStep(step, frame, records);
					if (records.some(r => r.kind !== 'world')) {
						this.runs.draw(records, frame.view);
					}
				};
			}
		}
		return runMapFrame(gpuPasses, this._ports.scene);
	}

	/**
	 * @param {string} step
	 * @param {Parameters<WebGL2Backend['drawFrame']>[0]} frame
	 * @param {ReadonlyArray<import('./ports.js').DrawRecord>} records
	 */
	_drawWorldStep(step, frame, records) {
		const world = this.world;
		const view = /** @type {any} */ (frame.view);
		const wf = frame.world ?? {};
		switch (step) {
			case 'postPrepare':
				if ('sky' in wf) {
					this._clear(clearColorFor(wf.sky).color);
				}
				break;
			case 'ground':
				world.drawGround(view, wf);
				break;
			case 'groundPickAndGridSelector':
				world.drawGrid(view, wf.grid);
				break;
			case 'occluderFadeBegin':
				world.beginOccluder(view, wf);
				break;
			case 'staticModels':
				world.drawStaticModels(view, wf);
				break;
			case 'animatedModels': {
				const matrices = new Map();
				for (const r of records) {
					const model =
						r.kind === 'world' && r.part === 'animatedModel' ? world.animated[r.params?.model ?? -1] : null;
					if (model && r.matrices) {
						matrices.set(model, r.matrices);
					}
				}
				world.drawAnimatedModels(view, { ...wf, matrices });
				break;
			}
			case 'water':
				world.drawWater(
					view,
					wf,
					/** @type {any} */ (records.find(r => r.kind === 'world' && r.part === 'water') ?? null)
				);
				break;
			case 'fadedModels':
				world.drawFaded(view, wf);
				break;
			default:
				break;
		}
		this.state.restoreDefault();
	}

	/**
	 * R-CTX-010 step 11 (C-14): the `world`/`gr2` records with the map light (and the
	 * frame's overrides), then any other record of the step.
	 * @param {Parameters<WebGL2Backend['drawFrame']>[0]} frame
	 * @param {ReadonlyArray<import('./ports.js').DrawRecord>} records
	 */
	_drawGr2(frame, records) {
		const gr2 = records.filter(r => r.kind === 'world' && r.part === 'gr2');
		if (gr2.length) {
			this.gr2.draw(
				/** @type {any} */ (gr2),
				/** @type {any} */ (frame.view),
				this.world.frameLight(frame.world ?? {})
			);
			this.state.restoreDefault();
		}
		if (gr2.length !== records.length) {
			this.runs.draw(
				records.filter(r => !(r.kind === 'world' && r.part === 'gr2')),
				frame.view
			);
		}
	}

	/** R-CTX-009: post-process prepare clears colour (the sky colour) and depth. */
	_clear(color) {
		const gl = this.device.gl;
		gl.clearColor(color[0], color[1], color[2], color[3]);
		gl.clearDepth(1);
		this.state.apply({
			blend: { src: 'SRC_ALPHA', dst: 'ONE_MINUS_SRC_ALPHA' },
			depthTest: true,
			depthWrite: true
		});
		gl.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
	}

	/**
	 * NFR-05 idle eviction hook: scene calls it from its asset-eviction tick (R-CTX-010
	 * step 24), between frames.
	 * @param {number} [maxAgeMs]
	 */
	evictIdle(maxAgeMs) {
		const evicted = this.residency ? this.residency.evictIdle(maxAgeMs) : { frames: 0, palettes: 0 };
		return { ...evicted, gr2Emblems: this.gr2Residency ? this.gr2Residency.evictIdle(maxAgeMs) : 0 };
	}

	/** R-CTX-005 */
	handleRenderError() {
		return onRenderError({ contextLost: Boolean(this.loss?.lost), settings: this._ports.settings });
	}

	/**
	 * Map-streaming worker messages (spec §3.2, payload shapes unchanged): MAP_WORLD,
	 * MAP_GROUND, MAP_ALTITUDE, MAP_MODELS, MAP_ANIMATED_MODEL. A message carrying a
	 * `request` other than the current map load's (`beginMap`) is dropped, as legacy
	 * MapRenderer's `loadEvent` does. Image sources decode asynchronously; the promise
	 * settles once the message's GPU uploads are done.
	 * @param {{type: string, payload: object, request?: unknown}} msg
	 * @returns {Promise<void>}
	 */
	acceptMapMessage(msg) {
		if (this._mapRequest !== undefined && msg.request !== undefined && msg.request !== this._mapRequest) {
			return Promise.resolve();
		}
		return this.world.accept(msg);
	}

	/**
	 * A new map load: free the current map's GPU scene (legacy MapRenderer.free) and
	 * accept only the messages of `request` from now on.
	 * @param {unknown} [request]
	 */
	beginMap(request) {
		this.world?.free();
		this.gr2Residency?.free();
		this._mapRequest = request;
	}

	/** Resolves once every MAP_* upload started so far has finished. */
	whenMapReady() {
		return this.world.whenReady();
	}

	/** C-20: capture the composed frame (preserveDrawingBuffer path). */
	capture() {
		throw new NotImplementedError('capture (C-20)');
	}

	/**
	 * A GR2 instance went away (legacy GR2ModelRenderer.detach): free its emblem texture.
	 * @param {unknown} emblem  the instance's emblem handle
	 */
	releaseGr2Emblem(emblem) {
		this.gr2Residency?.releaseEmblem(emblem);
	}

	dispose() {
		this.running = false;
		this.world?.free();
		this.gr2Residency?.free();
		this.residency?.uploader.dispose?.();
		this.residency?.purgeAll();
	}
}
