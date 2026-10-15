/**
 * Shared helpers for the track-H legacy effect GL snapshots and record diffs (spheres,
 * ground tiles, ground rings, target markers): a logging fake WebGL context, stateless
 * Client / Texture / WebGL mock bodies, a jsdom canvas stub, and an EffectManager-like
 * frame driver for one effect constructor.
 *
 * Texture identity: Client.loadFile hands the file name to the loader as its "buffer";
 * the fake image keeps it as `src`, a canvas drawn from it inherits it, and texImage2D
 * renames the bound texture object to it. Records therefore carry `texture.id === path`.
 * A file name containing 'missing' never loads.
 */
import { IDENTITY, PROJECTION } from './cylinderQuadHornScene.js';

export { IDENTITY, PROJECTION };

/** Serialize one GL argument (vectors as numbers, objects by id). */
export const serializeGlArg = v =>
	v === null || v === undefined || typeof v !== 'object'
		? v
		: ArrayBuffer.isView(v) || Array.isArray(v)
			? Array.from(v, Number)
			: (v.id ?? '[obj]');

/** One compact line per call; numbers print exactly. */
export const logLine = entry => entry.map(v => (Array.isArray(v) ? `[${v.join(',')}]` : String(v))).join(' ');

/**
 * Logging fake GL. Constants read as their names; every call is logged as one line.
 * createBuffer / createTexture return numbered objects (reset with gl.resetIds()).
 *
 * @param {string[]|null} log lines are appended here (null: no logging)
 */
export function createLoggingGl(log) {
	let buffers = 0;
	let textures = 0;
	let bound = null;
	return new Proxy(
		{},
		{
			get(_t, k) {
				if (k === 'resetIds') {
					return () => {
						buffers = 0;
						textures = 0;
						bound = null;
					};
				}
				if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) {
					return k;
				}
				return (...args) => {
					log?.push(logLine([k, ...args.map(serializeGlArg)]));
					if (k === 'createBuffer') {
						return { id: `buffer${++buffers}` };
					}
					if (k === 'createTexture') {
						return { id: `texture${++textures}` };
					}
					if (k === 'bindTexture') {
						bound = args[1];
					}
					if (k === 'texImage2D' && bound && args[5]?.src) {
						bound.id = args[5].src;
					}
					return undefined;
				};
			}
		}
	);
}

/** 2D context stub: drawing an image into a canvas carries its source name over. */
function fakeContext(canvas) {
	return {
		save() {},
		restore() {},
		translate() {},
		rotate() {},
		drawImage(source) {
			canvas.src = source.src;
		}
	};
}

/** Image-like object of a loaded file (Texture.load hands it as `this` and first argument). */
export function fakeImage(src) {
	const img = { src, width: 64, height: 32 };
	img.getContext = () => fakeContext(img);
	return img;
}

/** Utils/Texture.js mock body. */
export const textureMock = {
	default: {
		load(buffer, oncomplete) {
			const img = fakeImage(buffer);
			oncomplete.call(img, img);
		}
	}
};

/** Core/Client.js mock body (file name as buffer; 'missing' never loads). */
export const clientMock = {
	default: {
		loadFile(filename, onload) {
			if (!filename.includes('missing')) {
				onload(filename);
			}
		}
	}
};

/** Utils/WebGL.js mock body (uniform / attribute locations read as names). */
export const webglMock = {
	default: {
		createShaderProgram: () => ({
			id: 'program',
			attribute: new Proxy({}, { get: (_t, k) => `attr:${String(k)}` }),
			uniform: new Proxy({}, { get: (_t, k) => `uni:${String(k)}` })
		}),
		texture: (_gl, buffer, onload) => onload({ id: buffer })
	}
};

/** jsdom has no 2D canvas: give canvases the stub context (Tiles.loadTexture draws into one). */
export function installCanvasStub() {
	const proto = globalThis.HTMLCanvasElement.prototype;
	const saved = proto.getContext;
	proto.getContext = function getContext() {
		return fakeContext(this);
	};
	return () => {
		proto.getContext = saved;
	};
}

/** Scene fog of frame i (exists on two frames out of three). */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + i, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

/**
 * One EffectManager.render turn over a constructor's live instances: constructor init
 * gate, beforeRender, instance init / ready gate / render / cleanup, afterRender.
 *
 * @param {object} gl
 * @param {Function} Ctor
 * @param {Array<{effect: object}>} live instances (finished ones are removed in place)
 * @param {number} tick
 * @param {object} fog
 * @param {function} [onRender] (entry, tick, drawn) after each instance's turn
 */
export function renderClassFrame(gl, Ctor, live, tick, fog, onRender) {
	if (!Ctor.ready && Ctor.needInit) {
		Ctor.init(gl);
		Ctor.needInit = false;
	}
	if (!Ctor.ready) {
		return;
	}
	Ctor.beforeRender(gl, IDENTITY, PROJECTION, fog, tick, null);
	for (let j = 0; j < live.length; j++) {
		const entry = live[j];
		const { effect } = entry;
		if (!effect.ready && effect.needInit) {
			effect.init(gl);
			effect.needInit = false;
		}
		const drawn = Boolean(effect.ready);
		if (drawn) {
			effect.render(gl, tick);
		}
		onRender?.(entry, tick, drawn);
		if (effect.needCleanUp) {
			effect.free?.(gl);
			live.splice(j, 1);
			j--;
		}
	}
	Ctor.afterRender(gl);
}
