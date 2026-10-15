import { RenderDevice } from './device/RenderDevice.js';
import { DeviceLossController } from './device/DeviceLossController.js';
import { onRenderError } from './device/frameErrorPolicy.js';
import { DeviceUnavailableError, NotImplementedError } from './errors.js';
import { MAP_FRAME_STEPS, runMapFrame } from './frame/mapFrame.js';
import { TextureArrayPools } from './residency/TextureArrayPools.js';
import { SpriteResidency } from './residency/SpriteResidency.js';
import { RunRenderer } from './batching/RunRenderer.js';
import { batchKey, programOf } from './sprites/runs.js';
import { OffscreenTarget } from './target/OffscreenTarget.js';
import { Blit } from './target/Blit.js';
import { PostChain } from './post/PostChainRenderer.js';
import { buildPostPasses } from './post/postPasses.js';
import { POST_DEFAULTS, bloomSupported } from './post/postChain.js';
import { Capture } from './capture/Capture.js';
import { LivePreviews } from './preview/LivePreviews.js';

/**
 * Backend selection entry (`GraphicsSettings.renderer = 'auto'|'webgpu'|'webgl'`,
 * architecture §4 item 2). Returns the WebGPU device when available; otherwise
 * tells the caller to use gpu-webgl2. Never renders with a partial device.
 *
 * @param {{gpu: any, canvas: any, preference?: 'auto'|'webgpu'|'webgl'}} deps
 * @returns {Promise<{backend: 'webgpu', device: RenderDevice}|{backend: 'webgl2', reason: string}>}
 */
export async function selectBackend({ gpu, canvas, preference = 'auto' }) {
	if (preference === 'webgl') {
		return { backend: 'webgl2', reason: 'preference' };
	}
	try {
		const device = await new RenderDevice({ gpu, canvas }).init();
		return { backend: 'webgpu', device };
	} catch (err) {
		if (err instanceof DeviceUnavailableError) {
			return { backend: 'webgl2', reason: err.message };
		}
		throw err;
	}
}

/**
 * R-CTX-008: canvas backing store = CSS size × quality% × DPR (legacy Renderer.resize:
 * `width *= quality; canvas.width = width * dpr`, the canvas truncating). The CSS size stays
 * the window size, so a quality below 100 upscales; projection and debounce are scene's.
 * @param {{cssWidth: number, cssHeight: number, dpr?: number, quality?: number}} p
 * @returns {{width: number, height: number}}
 */
export function backingStoreSize({ cssWidth, cssHeight, dpr = 1, quality = 100 }) {
	const q = quality / 100;
	return {
		width: Math.max(1, Math.floor(cssWidth * q * dpr)),
		height: Math.max(1, Math.floor(cssHeight * q * dpr))
	};
}

/** R-CTX-009: no sky entry clears opaque black. */
const BLACK = Object.freeze([0, 0, 0, 1]);
/** GPU steps of R-CTX-010 that draw into the scene pass (all but post prepare / post-process). */
const SCENE_STEPS = Object.freeze(
	MAP_FRAME_STEPS.filter(s => s.owner === 'gpu' && s.step !== 'postPrepare' && s.step !== 'postProcess').map(
		s => s.step
	)
);
const LAST_SCENE_STEP = SCENE_STEPS[SCENE_STEPS.length - 1];
const NO_SCENE = Object.freeze({ runStep() {}, currentMap: () => null, setMap: async () => {} });
/** Settings the post chain reads (GraphicsSettings keys). */
const POST_SETTING_KEYS = Object.freeze([...Object.keys(POST_DEFAULTS), 'performanceMode']);

/**
 * Records of one frame per R-CTX-010 step. A flat stream (array or RecordStream) is the whole
 * scene pass, already in legacy order; an object maps step names (MAP_FRAME_STEPS) to records.
 * @param {ReadonlyArray<any>|{records: ReadonlyArray<any>}|Record<string, ReadonlyArray<any>>|null|undefined} stream
 * @returns {Record<string, ReadonlyArray<any>>}
 */
function recordsByStep(stream) {
	if (!stream) {
		return {};
	}
	if (Array.isArray(stream)) {
		return { [SCENE_STEPS[0]]: stream };
	}
	if (Array.isArray(stream.records)) {
		return { [SCENE_STEPS[0]]: stream.records };
	}
	for (const step of Object.keys(stream)) {
		if (!SCENE_STEPS.includes(step)) {
			throw new TypeError(`drawFrame: '${step}' is not a scene-pass step of R-CTX-010`);
		}
	}
	return stream;
}

/** Family label of a record without a renderer here (world, GR2, other effect families). */
const unsupportedKey = record => {
	const sub = record.family ?? record.part;
	return sub ? `${record.kind}:${sub}` : String(record.kind);
};

/**
 * gpu-webgpu backend facade. Same backend contract as gpu-webgl2:
 *
 *   kind, init(), resize(size), drawFrame(stream, frame), acceptMapMessage(msg),
 *   capture(), handleRenderError(err), evictIdle(ms), dispose()
 *
 * One frame (R-CTX-010) is one command encoder: the scene pass (clear colour from the
 * frame / sky, R-CTX-009; every scene-step record in legacy order through RunRenderer:
 * sprites, 2D/3D, STR and the mesh effect families; families without a renderer yet,
 * world, GR2 and the SpriteRenderer-drawn weather among them, are counted in
 * `unsupportedRecords` and left out), then the post chain when any
 * module is active, else the blit, then the C-20 capture copy, one submit. Non-GPU steps
 * run in order through ScenePort.runStep. Owns no rendering rules: every value comes from
 * the records, the settings and the frame.
 *
 * Device loss (R-CTX-006/007): DeviceLossController purges, shows the overlay, rebuilds on a
 * new device (residency re-uploads on demand, pipelines/target/blit/post recreated, previews
 * reconfigured, setMap(currentMap) re-run) or hands over to gpu-webgl2. `recovered()` waits for it.
 */
export class WebGpuBackend {
	/**
	 * @param {{
	 *   gpu: import('./ports.js').GpuPort,
	 *   canvas: import('./ports.js').CanvasPort,
	 *   overlay: import('./ports.js').OverlayPort,
	 *   assets: import('./ports.js').AssetCachePort,
	 *   settings: import('./ports.js').SettingsPort,
	 *   scene?: import('./ports.js').ScenePort,
	 *   fallback: import('./ports.js').FallbackPort,
	 *   now: () => number,
	 *   frames?: import('./residency/SpriteResidency.js').FrameSourcePort|null,
	 *   renderDevice?: RenderDevice,
	 *   previews?: LivePreviews,
	 *   sampleCount?: number,
	 *   depthFormat?: GPUTextureFormat,
	 *   mixTextureClasses?: boolean,
	 *   allowSoftwareAdapter?: boolean,
	 *   userAgent?: string,
	 *   log?: (message: string, err?: unknown) => void
	 * }} ports  `renderDevice`: an initialised RenderDevice (selectBackend's); `sampleCount` 1 turns
	 *   MSAA off (default 4); `depthFormat` replaces the scene depth24plus (the backend smoke page's
	 *   legacy-FBO run uses depth16unorm); `allowSoftwareAdapter`: R-PP-004 integration decision #2 (smoke goldens)
	 */
	constructor(ports) {
		this.kind = 'webgpu';
		this._ports = ports;
		this._scene = ports.scene ?? NO_SCENE;
		/** @type {RenderDevice|null} */
		this.renderDevice = null;
		/** @type {GPUDevice|null} */
		this.device = null;
		this.format = null;
		this.pools = null;
		this.residency = null;
		this.runs = null;
		this.target = null;
		this.blit = null;
		this.post = null;
		this.capturer = null;
		this.previews = null;
		this.loss = null;
		this.bloomAllowed = true;
		/** Handed over to gpu-webgl2 after a loss with no adapter (R-CTX-007). */
		this.retired = false;
		this._disposed = false;
		this._initialised = false;
		/** @type {Promise<'webgpu'|'webgl2'|'lost'>|null} */
		this._recovery = null;
		/** Last requested backing-store size (applied again after a rebuild, R-CTX-007). */
		this._size = null;
		/** One record per pipeline the stream needed (`warm`), recompiled on a new device. */
		this._warmed = new Map();
		/** WebGPU uncaptured errors (validation, out-of-memory), newest last. */
		this.errors = [];
		/** Frame counters: drawn frames, records left out because no renderer exists here yet. */
		this.stats = { frames: 0, unsupportedRecords: 0, renderErrors: 0 };
		/** Stats of the last drawn frame. */
		this.lastFrame = null;
		/** The last render error (R-CTX-005). */
		this.lastError = null;
	}

	/** True while frames are drawn (not lost, not handed over to gpu-webgl2). */
	get running() {
		return this._initialised && !this.retired && !this._disposed && Boolean(this.loss?.rendering);
	}

	/** R-CTX-001/002: device (or selectBackend's), every GPU object, then the loss wiring. */
	async init() {
		const ports = this._ports;
		const { sampleCount, depthFormat } = ports;
		this.loss = new DeviceLossController({
			overlay: ports.overlay,
			assets: ports.assets,
			scene: this._scene,
			fallback: ports.fallback,
			createDevice: () => new RenderDevice({ gpu: ports.gpu, canvas: ports.canvas }).init(),
			previews: { reconfigureAll: device => this.previews.reconfigureAll(device) },
			residency: {
				purgeAll: () => this.residency.purgeAll(),
				reset: device => {
					this.pools.device = device;
				}
			},
			pipelines: { rebuild: device => this._rebuildScenePass(device) },
			postChain: { rebuild: device => this.post.rebuild(device) },
			onDevice: renderDevice => this._adopt(renderDevice)
		});
		const renderDevice =
			ports.renderDevice ?? (await new RenderDevice({ gpu: ports.gpu, canvas: ports.canvas }).init());
		this._adopt(renderDevice);
		const { device, format } = this;
		this.pools = new TextureArrayPools({ device });
		this.residency = new SpriteResidency({ uploader: this.pools, now: ports.now, source: ports.frames ?? null });
		this.runs = await new RunRenderer({
			device,
			residency: this.residency,
			sampleCount,
			depthFormat,
			mixTextureClasses: ports.mixTextureClasses
		}).init();
		this.target = new OffscreenTarget(device, { sampleCount, depthFormat });
		this.blit = await new Blit({ device, format }).init();
		this.post = await new PostChain({ device, format }).init();
		this.capturer = new Capture({ device });
		this.previews = ports.previews ?? new LivePreviews({ device, format });
		this.bloomAllowed = bloomSupported(
			{
				...(renderDevice.adapter?.info ?? {}),
				userAgent: ports.userAgent ?? globalThis.navigator?.userAgent ?? ''
			},
			{ allowSoftwareAdapter: Boolean(ports.allowSoftwareAdapter) }
		);
		this._initialised = true;
		return this;
	}

	/** Take `renderDevice` as the current device and watch it for loss and uncaptured errors. */
	_adopt(renderDevice) {
		this.renderDevice = renderDevice;
		this.device = renderDevice.device;
		this.format = renderDevice.canvasFormat;
		const device = this.device;
		device.addEventListener?.('uncapturederror', event => {
			if (this.device !== device) {
				return;
			}
			const error = event.error;
			this.errors.push(String(error?.message ?? error));
			// R-CTX-005 resource-pressure fallback: WebGPU reports OOM asynchronously, not by throwing.
			if (error?.constructor?.name === 'GPUOutOfMemoryError') {
				this.handleRenderError(error);
			}
		});
		const lost = renderDevice.lostPromise ?? device.lost;
		lost?.then(info => {
			// destroy() resolves `lost` too ('destroyed'): a loss unless we disposed it ourselves.
			if (!this._disposed && this.device === device) {
				this._onDeviceLost(info);
			}
		});
	}

	_onDeviceLost(info) {
		this.loss.onLost(info);
		this._recovery = this.loss.rebuild().then(
			kind => {
				if (kind === 'webgl2') {
					this.retired = true;
				}
				return kind;
			},
			err => {
				// E.g. the new device was lost during the rebuild: its own `lost` starts the next one.
				this.lastError = err;
				this._ports.log?.('[gpu-webgpu] device rebuild failed', err);
				return 'lost';
			}
		);
	}

	/**
	 * Resolves once a device loss is handled: 'webgpu' (rebuilt), 'webgl2' (handed over) or 'lost'
	 * (the rebuild failed; the next loss retries); 'webgpu' at once when nothing was lost.
	 * @returns {Promise<'webgpu'|'webgl2'|'lost'>}
	 */
	recovered() {
		return this._recovery ?? Promise.resolve(this.retired ? 'webgl2' : 'webgpu');
	}

	/** R-CTX-007: renderers of the scene pass, target and blit on the new device. */
	async _rebuildScenePass(device) {
		this.runs.reset(device);
		await this.runs.init();
		if (this._warmed.size) {
			await this.runs.warm([...this._warmed.values()]);
		}
		this.target.destroy();
		const { sampleCount, depthFormat } = this.target;
		this.target = new OffscreenTarget(device, { sampleCount, depthFormat });
		this.blit = await new Blit({ device, format: this.format }).init();
		this.capturer.reset(device);
		if (this._size) {
			this._applySize(this._size);
		}
	}

	/**
	 * R-CTX-008 backing-store sizing (`backingStoreSize`). Ignored while the device is lost
	 * (R-CTX-006); the size is kept and applied by the rebuild. The offscreen and post targets
	 * follow the canvas on the next frame.
	 * @param {{cssWidth: number, cssHeight: number, dpr?: number, quality?: number}} size
	 * @returns {{width: number, height: number}|null}  null while lost
	 */
	resize(size) {
		this._size = backingStoreSize(size);
		if (!this.loss.shouldHandleResize()) {
			return null;
		}
		this._applySize(this._size);
		return { ...this._size };
	}

	_applySize({ width, height }) {
		this._ports.canvas.width = width;
		this._ports.canvas.height = height;
	}

	/**
	 * Compile every pipeline `stream` needs (e.g. at map load), so no batch of it draws with the
	 * normal-alpha fallback; remembered and recompiled after a device loss.
	 * @param {Parameters<typeof recordsByStep>[0]} stream
	 */
	async warm(stream) {
		const records = Object.values(recordsByStep(stream)).flat();
		for (const record of records) {
			if (programOf(record)) {
				const key = batchKey(record);
				if (!this._warmed.has(key)) {
					this._warmed.set(key, record);
				}
			}
		}
		await this.runs.warm(records);
	}

	/**
	 * Draw one frame in R-CTX-010 order (class comment).
	 * @param {Parameters<typeof recordsByStep>[0]} stream  Records, legacy order (flat or per step)
	 * @param {{
	 *   view?: import('./sprites/SpriteRunRenderer.js').SpriteView,
	 *   clearColor?: ArrayLike<number>,
	 *   sky?: {clearColor: ArrayLike<number>},
	 *   post?: {illusion?: boolean, blind?: boolean, zoomFinal?: number}
	 * }} [frame]  `clearColor` or `sky` (skyForMap's) give the clear colour (R-CTX-009)
	 * @returns {object}  Frame stats; `{drawn: false, reason}` while lost / retired;
	 *   `{drawn: false, error, action, bloomDisabled}` after a render error (R-CTX-005)
	 */
	drawFrame(stream, frame = {}) {
		if (!this.running) {
			return { drawn: false, reason: this.retired ? 'retired' : this._disposed ? 'disposed' : 'lost' };
		}
		try {
			return this._drawFrame(recordsByStep(stream), frame);
		} catch (err) {
			return { drawn: false, error: err, ...this.handleRenderError(err) };
		}
	}

	_drawFrame(byStep, frame) {
		const { device } = this;
		const canvas = { width: this._ports.canvas.width, height: this._ports.canvas.height };
		const settings = this._postSettings();
		const graph = buildPostPasses(settings, { ...frame.post, bloomAllowed: this.bloomAllowed }, canvas);
		const records = [];
		const unsupportedByFamily = {};
		let unsupported = 0;
		let encoder = null;
		let scene = null;
		let post = null;
		let captureJob = null;

		const collect = step => {
			for (const record of byStep[step] ?? []) {
				if (programOf(record)) {
					records.push(record);
				} else {
					const key = unsupportedKey(record);
					unsupportedByFamily[key] = (unsupportedByFamily[key] ?? 0) + 1;
					unsupported++;
				}
			}
		};
		const gpuSteps = {
			// 1: the scene pass clears colour (sky, R-CTX-009) and depth when it begins (below).
			postPrepare: () => {
				this.target.resize(graph.sizes.scene.width, graph.sizes.scene.height);
				encoder = device.createCommandEncoder({ label: 'frame' });
			},
			// 25: post chain when any module is active, else the blit; then the capture copy.
			postProcess: () => {
				const swap = this.renderDevice.context.getCurrentTexture();
				const view = swap.createView();
				if (graph.plan.directBlit) {
					this.blit.encode(encoder, this.target.resolve, view);
					post = 'blit';
				} else {
					this.post.encode(encoder, graph, this.target.resolve, view);
					post = graph.plan.modules.join('+');
				}
				captureJob = this.capturer.encode(encoder, swap, { ...canvas, format: this.format });
			}
		};
		// One scene pass for every scene step (architecture §2.2 "Frame"), encoded once the last
		// scene step has collected its records: one instance upload per frame, stream order kept.
		const encodeScene = () => {
			const pass = encoder.beginRenderPass(this.target.passDescriptor(this._clearColor(frame)));
			this.residency.beginFrame();
			const stats = this.runs.encode(pass, records, frame.view);
			pass.end();
			return stats;
		};
		for (const step of SCENE_STEPS) {
			gpuSteps[step] = () => {
				collect(step);
				if (step === LAST_SCENE_STEP) {
					scene = encodeScene();
				}
			};
		}

		const steps = runMapFrame(gpuSteps, this._scene);
		device.queue.submit([encoder.finish()]);
		captureJob?.finish();

		this.stats.frames++;
		this.stats.unsupportedRecords += unsupported;
		this.lastFrame = {
			drawn: true,
			steps,
			records: records.length,
			unsupportedRecords: unsupported,
			unsupportedByFamily,
			...scene,
			uploads: this.runs.lastUploads,
			post,
			postPasses: graph.plan.directBlit ? 0 : graph.passes.length,
			sceneSize: { ...graph.sizes.scene },
			captured: Boolean(captureJob)
		};
		return this.lastFrame;
	}

	_clearColor(frame) {
		const c = frame.clearColor ?? frame.sky?.clearColor ?? BLACK;
		return [c[0], c[1], c[2], c[3] ?? 1];
	}

	/** GraphicsSettings snapshot the post chain reads (R-PP-012 defaults for missing keys). */
	_postSettings() {
		const out = {};
		for (const key of POST_SETTING_KEYS) {
			out[key] = this._ports.settings.get(key) ?? POST_DEFAULTS[key] ?? false;
		}
		return out;
	}

	/**
	 * C-20: the next drawn frame, as it reaches the canvas (after the post chain, so after any
	 * VerticalFlip), as an ImageData-like `{width, height, data}` with top-down RGBA rows.
	 * @returns {Promise<import('./capture/Capture.js').CaptureImage>}
	 */
	capture() {
		return this.capturer.request();
	}

	/**
	 * R-CTX-005, as gpu-webgl2: a render error with the device alive turns bloom off
	 * permanently (if it was on) and the loop continues; with the device lost the loop exits
	 * (DeviceLossController takes over).
	 * @param {unknown} [err]
	 */
	handleRenderError(err) {
		this.stats.renderErrors++;
		this.lastError = err ?? null;
		this._ports.log?.('[gpu-webgpu] render error', err);
		return onRenderError({
			deviceLost: Boolean(this.loss?.lost || this.renderDevice?.lost),
			settings: this._ports.settings
		});
	}

	/**
	 * NFR-05 idle eviction hook (scene's R-CTX-010 step 24, between frames).
	 * @param {number} [maxAgeMs]
	 */
	evictIdle(maxAgeMs) {
		return this.residency ? this.residency.evictIdle(maxAgeMs) : { frames: 0, palettes: 0 };
	}

	/**
	 * Map-streaming worker messages (§3.2): MAP_GROUND, MAP_MODELS, MAP_ANIMATED_MODEL, MAP_WORLD.
	 * @param {{type: string, payload: object}} _msg
	 */
	acceptMapMessage(_msg) {
		throw new NotImplementedError('acceptMapMessage (C-17 GPU upload)');
	}

	dispose() {
		this._disposed = true;
		this.post?.destroy();
		this.target?.destroy();
		this.pools?.dispose();
		this.residency?.purgeAll();
		this.renderDevice?.destroy();
	}
}
