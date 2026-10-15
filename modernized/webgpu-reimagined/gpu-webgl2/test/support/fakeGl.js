import { GL } from '../../src/pipeline/glEnums.js';

/**
 * Recording fake WebGL2 context. Every method call is appended to `calls`
 * as [name, ...args]. Explicit methods cover device, state, run and post
 * tests; any other method is recorded through a Proxy fallback.
 */
export function createFakeGl({ limits = {} } = {}) {
	const calls = [];
	const params = { [GL.MAX_TEXTURE_SIZE]: 4096, [GL.MAX_ARRAY_TEXTURE_LAYERS]: 256, ...limits };
	const record =
		name =>
		(...args) => {
			// Real GL copies buffer data at call time; snapshot typed-array views likewise.
			calls.push([name, ...args.map(a => (ArrayBuffer.isView(a) ? a.slice() : a))]);
		};
	const gl = {
		calls,
		getParameter: p => params[p],
		clearDepth: record('clearDepth'),
		enable: record('enable'),
		disable: record('disable'),
		depthFunc: record('depthFunc'),
		depthMask: record('depthMask'),
		blendFunc: record('blendFunc'),
		blendColor: record('blendColor'),
		bufferSubData: record('bufferSubData'),
		drawArraysInstanced: record('drawArraysInstanced'),
		drawArrays: record('drawArrays'),
		/** @param {string} name */
		callsTo: name => calls.filter(c => c[0] === name),
		clearCalls: () => {
			calls.length = 0;
		}
	};
	// Any other WebGL2 method (program, buffer, texture and VAO setup) records its call
	// and returns a plausible value: an opaque handle for create*/getUniformLocation,
	// success for status queries, '' for info logs.
	let handles = 0;
	const fallback = name => {
		const log = record(name);
		return (...args) => {
			log(...args);
			if (name.startsWith('create')) {
				return { fake: name, id: ++handles };
			}
			if (name === 'getUniformLocation') {
				return { uniform: args[1] };
			}
			if (name === 'getShaderParameter' || name === 'getProgramParameter') {
				return true;
			}
			if (name.endsWith('InfoLog')) {
				return '';
			}
			return undefined;
		};
	};
	return new Proxy(gl, {
		get(target, prop) {
			if (prop in target || typeof prop !== 'string' || !/^[a-z]/.test(prop) || prop === 'then') {
				return target[prop];
			}
			target[prop] = fallback(prop);
			return target[prop];
		}
	});
}

/**
 * Fake canvas. `contexts` maps context name → gl (or null). Records the
 * attributes it was asked for and keeps event listeners for loss/restore.
 */
export function createFakeCanvas({ contexts = { webgl2: createFakeGl() }, width = 800, height = 600 } = {}) {
	const listeners = {};
	const requests = [];
	return {
		width,
		height,
		requests,
		getContext(name, attrs) {
			requests.push({ name, attrs });
			return contexts[name] ?? null;
		},
		addEventListener(type, fn) {
			(listeners[type] ??= []).push(fn);
		},
		fire(type, ev = { preventDefault() {} }) {
			for (const fn of listeners[type] ?? []) {
				fn(ev);
			}
		}
	};
}

export function createFakePorts(overrides = {}) {
	const log = [];
	const settings = new Map(Object.entries(overrides.settings ?? {}));
	return {
		log,
		overlay: { show: spec => log.push(['overlay.show', spec]), hide: () => log.push(['overlay.hide']) },
		assets: { purge: exts => log.push(['assets.purge', [...exts]]) },
		settings: { get: k => settings.get(k), set: (k, v) => settings.set(k, v) },
		scene: {
			runStep: step => log.push(['scene', step]),
			currentMap: () => 'prontera',
			rebuildMap: () => log.push(['scene.rebuildMap'])
		},
		now: () => 0
	};
}
