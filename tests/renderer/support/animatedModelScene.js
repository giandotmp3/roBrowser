/**
 * Animated RSM map models for AnimatedModels.records.test.js and
 * RecordDiff.animatedModels.test.js: MAP_ANIMATED_MODEL payloads (the
 * MapLoader.sendAnimatedModels shape) built from the root RSM fixtures of
 * support/rsmEffectScene.js (MODELS), a tick list and per-frame settings.
 *
 * Covers every branch of legacy Renderer/Map/AnimatedModels.js: rotation slerp, position
 * and scale keys (and single keys), a first position key after frame 0 (legacy
 * interpolates with t = −∞ before it: NaN matrices, see discrepancy notes in the record
 * diff), axis-angle fallback, smooth / flat / unknown shading, mat3, is_only, a parent
 * chain, a node parented to itself and to an unknown name, the "static prefix" quirk (nodes
 * before the first animated one use a precomputed local matrix), animLen 0 (derived as max
 * keyframe + 1), the default 30 fps, a model with no animated node (matrices computed once),
 * a payload with no node (ignored), a texture that fails to load (its draws are skipped),
 * several instances, performance mode (fps / 2) and the occluder-fade passes.
 */
import { MODELS } from './rsmEffectScene.js';

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A column-major instance matrix: T(position)·RotY(yaw)·Scale(s, −s, s) (RSM y points down). */
function instanceMatrix([x, y, z], yawDeg, s) {
	const r = (yawDeg * Math.PI) / 180;
	const c = Math.cos(r);
	const n = Math.sin(r);
	return [c * s, 0, -n * s, 0, 0, -s, 0, 0, n * s, 0, c * s, 0, x, y, z, 1];
}

/** Keyframes counted in frames of a short loop, stretched to ms (legacy reads ms as frames). */
const stretch = (keys, msPerFrame) =>
	keys.map(k => ({
		...k,
		...(k.frame !== undefined ? { frame: k.frame * msPerFrame } : {}),
		...(k.Frame !== undefined ? { Frame: k.Frame * msPerFrame } : {})
	}));

function payload(file, { shadeType, alpha, instances, msPerFrame, names, parents, fps, animLen }) {
	const desc = MODELS[file];
	return {
		filename: file,
		animLen: animLen ?? (desc.animLen ?? 0) * msPerFrame,
		frameRatePerSecond: fps,
		shadeType,
		alpha,
		textures: desc.textures.slice(),
		instances,
		nodes: desc.nodes.map((node, i) => ({
			name: names[i],
			parentname: parents[i],
			is_only: node.is_only,
			textures: node.textures.slice(),
			vertices: node.vertices,
			tvertices: Array.from(node.tvertices),
			faces: node.faces,
			pos: node.pos.slice(),
			rotangle: node.rotangle,
			rotaxis: node.rotaxis.slice(),
			scale: node.scale.slice(),
			offset: node.offset.slice(),
			mat3: (node.mat3 ?? IDENTITY3).slice(),
			rotKeyframes: stretch(node.rotKeyframes, msPerFrame),
			posKeyframes: stretch(node.posKeyframes, msPerFrame),
			scaleKeyFrames: stretch(node.scaleKeyFrames, msPerFrame)
		})),
		box: {
			center: [0.25, 1, -0.5],
			max: [1, 2.5, 1],
			min: [-1, 0, -1],
			offset: [0, 0, 0],
			range: [1, 1.25, 1]
		}
	};
}

/** Fresh MAP_ANIMATED_MODEL payloads, in load order (index = the model's params.model). */
export function animatedPayloads() {
	return [
		payload('data\\model\\effect\\spin.rsm', {
			shadeType: 2,
			alpha: 1,
			msPerFrame: 60,
			fps: 20,
			names: ['root', 'arm', 'tip'],
			parents: ['', 'root', 'arm'],
			instances: [instanceMatrix([14, -1, 15], 20, 0.9), instanceMatrix([20, -0.5, 10], -35, 0.7)]
		}),
		payload('data\\model\\effect\\stale.rsm', {
			shadeType: 1,
			alpha: 0.75,
			msPerFrame: 100,
			fps: 10,
			names: ['body', 'cap'],
			parents: ['', 'body'],
			instances: [instanceMatrix([10, 0, 17], 70, 1.1)]
		}),
		payload('data\\model\\effect\\regrow.rsm', {
			shadeType: 7,
			alpha: 0.9,
			msPerFrame: 45,
			animLen: 0,
			names: ['base', 'lid'],
			parents: ['', 'lid'],
			instances: [instanceMatrix([18, 0, 12], 0, 1), instanceMatrix([22, -2, 14], 90, 0.5)]
		}),
		payload('data\\model\\effect\\frozen.rsm', {
			shadeType: 0,
			alpha: 1,
			msPerFrame: 30,
			names: ['only'],
			parents: ['nowhere'],
			instances: [instanceMatrix([12, 0, 12], 45, 1)]
		}),
		payload('data\\model\\effect\\static.rsm', {
			shadeType: 1,
			alpha: 1,
			msPerFrame: 1,
			names: ['a', 'b'],
			parents: ['', 'a'],
			instances: [instanceMatrix([16, 0, 20], 10, 1)]
		}),
		{ ...payload('data\\model\\effect\\static.rsm', { shadeType: 0, alpha: 1, msPerFrame: 1, names: [], parents: [], instances: [] }), nodes: [] }
	];
}

/** Frame ticks: same-bucket repeats, single steps, jumps and loop wrap-arounds. */
export const TICKS = Object.freeze(
	(() => {
		const ticks = [0, 5, 20, 39, 40, 41, 76, 77, 120, 200, 260, 299, 300, 301, 450];
		for (let t = 500; t <= 6000; t += 97) {
			ticks.push(t);
		}
		ticks.push(6000, 6001, 9999);
		return ticks;
	})()
);

/**
 * Per-frame settings: performance mode in one segment; the occluder fade off, then
 * 'dither', then 'alpha' (with the query result toggling so the fade eases in and out).
 */
export function settingsAt(i) {
	return {
		performanceMode: i >= 20 && i < 35,
		occluderFade: i < 10 ? 'off' : i < 30 ? 'dither' : 'alpha',
		queryHit: Math.floor(i / 6) % 2 === 0
	};
}

/** Scene fog and light of frame i. */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + i, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

export function lightAt(i) {
	return {
		direction: new Float32Array([0.3, -0.9, 0.2]),
		opacity: 0.8,
		ambient: new Float32Array([0.4, 0.4, 0.45 + (i % 2) * 0.01]),
		diffuse: new Float32Array([0.9, 0.85, 0.8]),
		env: new Float32Array([0.95, 0.9, 0.9])
	};
}

export const MODEL_VIEW = new Float32Array([1, 0, 0, 0, 0, 0.8, -0.6, 0, 0, 0.6, 0.8, 0, -15, -3, -40, 1]);
export const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);
export const NORMAL3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
