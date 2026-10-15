/**
 * Synthetic RSM effect models (EffectTable 'RSM' / 'RSM2') for legacy
 * Renderer/Effects/RsmEffect.js, a scripted tick list and an EffectManager-like driver.
 * Shared by the GL snapshot test (RsmEffect.records.test.js) and the record diff.
 *
 * The RSM loader (Loaders/Model.js) is outside the renderer: tests replace it with
 * FakeModel, which serves the node data RsmEffect animates (keyframes, box, matrices,
 * faces, smoothing groups) and a simple deterministic static compile(). Both sides of a
 * diff get their own FakeModel built from the same description.
 *
 * Files: Client.getFile(model) never answers for a name containing 'missing'; a texture
 * whose path contains 'missing' fails to load (Client.loadFile calls its error callback).
 */

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const PROJECTION = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0]);

/** Ticks: same-frame repeats, frame steps, a frame before start, wrap-arounds. */
export const TICKS = (() => {
	const ticks = [0, 10, 20, 37, 50, 51, 120, 260, 300];
	for (let t = 350; t <= 4200; t += 83) {
		ticks.push(t);
	}
	return ticks;
})();

/** Scene fog of frame i (exists on two frames out of three). */
export function fogAt(i) {
	return { use: true, exist: i % 3 !== 0, near: 10 + i, far: 100, color: new Float32Array([0.5, 0.6, 0.7]) };
}

/** Owner entity followed by attached effects. */
export function makeOwner() {
	return { position: new Float32Array([20, 30, 1.5]) };
}

/** Move the owner in place (Entity.position is a vec3 mutated by walking). */
export function moveOwner(owner, tick) {
	owner.position[0] = 20 + tick / 2500;
	owner.position[1] = 30 - tick / 5000;
	owner.position[2] = 1.5 + tick / 40000;
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A small prism: 6 vertices, 8 faces, 4 uv pairs. */
function prism(scale, shift) {
	const v = [
		[-1, 0, -1],
		[1, 0, -1],
		[0, 0, 1],
		[-1, 2, -1],
		[1, 2, -1],
		[0, 2.5, 1]
	].map(p => p.map((c, i) => c * scale + shift[i]));
	const tv = new Float32Array(6 * 4);
	[
		[0, 0],
		[1, 0],
		[0.5, 1],
		[0.25, 0.75]
	].forEach(([u, w], i) => {
		tv.set([0, 0, 0, 0, u, w], i * 6);
	});
	return { vertices: v, tvertices: tv };
}

function faces(texids, groups) {
	const tri = [
		[0, 1, 2],
		[3, 5, 4],
		[0, 3, 4],
		[0, 4, 1],
		[1, 4, 5],
		[1, 5, 2],
		[2, 5, 3],
		[2, 3, 0]
	];
	return tri.map((vertidx, i) => ({
		vertidx,
		tvertidx: [i % 4, (i + 1) % 4, (i + 2) % 4],
		texid: texids[i % texids.length],
		smoothGroup: groups[i % groups.length]
	}));
}

function node(fields) {
	const { vertices, tvertices } = prism(fields.scaleGeom ?? 1, fields.shift ?? [0, 0, 0]);
	return {
		main: { box: { center: [0.25, 1, -0.5], max: [1, 2.5, 1] }, alpha: fields.alpha ?? 1, shadeType: fields.shadeType ?? 0 },
		pos: fields.pos ?? [0, 0, 0],
		rotangle: fields.rotangle ?? 0,
		rotaxis: fields.rotaxis ?? [0, 0, 0],
		scale: fields.scale ?? [1, 1, 1],
		offset: fields.offset ?? [0.5, -0.25, 0.75],
		is_only: fields.is_only ?? false,
		mat3: fields.mat3 ?? IDENTITY3,
		vertices,
		tvertices,
		faces: faces(fields.texids ?? [0], fields.groups ?? [0]),
		textures: fields.textures ?? [0],
		rotKeyframes: fields.rotKeyframes ?? [],
		posKeyframes: fields.posKeyframes ?? [],
		scaleKeyFrames: fields.scaleKeyFrames ?? []
	};
}

const q = (axis, deg) => {
	const s = Math.sin((deg * Math.PI) / 360);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((deg * Math.PI) / 360)];
};

/** Model descriptions by RsmEffect filename ('data\\model\\' + file + '.rsm'). */
export const MODELS = {
	'data\\model\\effect\\static.rsm': {
		textures: ['effect/ice.bmp', 'effect/stone.bmp'],
		nodes: [
			node({ shadeType: 0, textures: [0, 1], texids: [0, 1], rotangle: 0.5, rotaxis: [0, 1, 0] }),
			node({ shadeType: 1, textures: [1], shift: [2, 0, 0], scale: [1.5, 1, 0.5], alpha: 0.5, is_only: true })
		]
	},
	'data\\model\\effect\\static_badtex.rsm': {
		textures: ['effect/ice.bmp', 'effect/missing.bmp'],
		nodes: [node({ textures: [0, 1], texids: [0, 1] })]
	},
	'data\\model\\effect\\spin.rsm': {
		animLen: 40,
		frameRatePerSecond: 20,
		textures: ['effect/ice.bmp', 'effect/stone.bmp', 'effect/fire.bmp'],
		nodes: [
			node({
				shadeType: 2,
				textures: [0, 2],
				texids: [0, 1],
				groups: [0, 3, 3, 3],
				rotKeyframes: [
					{ frame: 0, q: q([0, 1, 0], 0) },
					{ frame: 10, q: q([0, 1, 0], 120) },
					{ frame: 30, q: q([1, 0, 0], 200) }
				],
				posKeyframes: [
					{ frame: 5, px: 0, py: 0, pz: 0 },
					{ frame: 25, px: 1, py: -0.5, pz: 2 }
				],
				scaleKeyFrames: [
					{ Frame: 0, Scale: [1, 1, 1] },
					{ Frame: 20, Scale: [2, 0.5, 1.5] }
				],
				mat3: [0, 0, 1, 0, 1, 0, -1, 0, 0]
			}),
			node({
				shadeType: 1,
				textures: [1],
				shift: [0, 1, 0],
				rotKeyframes: [{ frame: 3, q: [0, 0, 0.6, 0.8] }],
				posKeyframes: [{ frame: 3, px: 0.5, py: 0.5, pz: 0.5 }],
				scaleKeyFrames: [{ Frame: 3, Scale: [1, 2, 1] }],
				is_only: true
			}),
			node({ shadeType: 0, textures: [2], shift: [-2, 0, 0], rotangle: 1, rotaxis: [1, 1, 0], scale: [0.5, 0.5, 0.5] })
		]
	},
	// default fps (30), rotation keyframes only on a later node; the static compile only
	// covers the first node, so the first rebuild changes the object count (texture reload)
	'data\\model\\effect\\regrow.rsm': {
		animLen: 12,
		compileNodes: 1,
		textures: ['effect/ice.bmp', 'effect/missing_regrow.bmp'],
		nodes: [
			node({ textures: [0], shadeType: 7 }),
			node({
				shadeType: 1,
				textures: [1],
				rotKeyframes: [
					{ frame: 2, q: q([0, 0, 1], 45) },
					{ frame: 8, q: q([0, 0, 1], -45) }
				]
			})
		]
	},
	// the static compile lists the nodes in reverse, with the same object count: the first
	// rebuild keeps the objects' textures (stale), so meshes swap textures
	'data\\model\\effect\\stale.rsm': {
		animLen: 8,
		frameRatePerSecond: 10,
		compileReverse: true,
		textures: ['effect/ice.bmp', 'effect/fire.bmp'],
		nodes: [
			node({ textures: [0], scaleKeyFrames: [{ Frame: 0, Scale: [1, 1.5, 1] }] }),
			node({ textures: [1], shift: [0, 0, 2], scaleGeom: 0.5 })
		]
	},
	// keyframes but animLen 0: drawn from the static compile, never rebuilt
	'data\\model\\effect\\frozen.rsm': {
		animLen: 0,
		textures: ['effect/stone.bmp'],
		nodes: [node({ textures: [0], posKeyframes: [{ frame: 0, px: 1, py: 1, pz: 1 }] })]
	}
};

/**
 * Stand-in for Loaders/Model.js (the RSM parser): node data (each model owns a copy) plus
 * createInstance and a deterministic static compile (per node and instance, one mesh per model texture,
 * 9 floats per vertex: position, normal, uv, alpha).
 */
export class FakeModel {
	constructor(filename) {
		const desc = MODELS[filename];
		this.animLen = desc.animLen;
		this.frameRatePerSecond = desc.frameRatePerSecond;
		this.textures = desc.textures;
		this.nodes = structuredClone(desc.nodes);
		this.alpha = 1;
		this.instances = [];
		this.compileNodes = desc.compileNodes ?? desc.nodes.length;
		this.compileReverse = Boolean(desc.compileReverse);
	}

	createInstance(model, width, height) {
		const [sx, sy, sz] = model.scale;
		this.instances.push([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, model.position[0] + width, model.position[1], model.position[2] + height, 1]);
	}

	compile() {
		const meshes = [];
		const nodes = this.nodes.slice(0, this.compileNodes);
		for (const node of this.compileReverse ? nodes.reverse() : nodes) {
			for (const m of this.instances) {
				const mesh = {};
				for (const face of node.faces) {
					const t = node.textures[face.texid];
					const out = (mesh[t] ??= []);
					face.vertidx.forEach((vi, j) => {
						const [x, y, z] = node.vertices[vi];
						const b = face.tvertidx[j] * 6;
						out.push(
							m[0] * x + m[12],
							m[5] * y + m[13],
							m[10] * z + m[14],
							0,
							-1,
							0,
							node.tvertices[b + 4],
							node.tvertices[b + 5],
							node.main.alpha
						);
					});
				}
				meshes.push(Object.fromEntries(Object.entries(mesh).map(([k, v]) => [k, new Float32Array(v)])));
			}
		}
		return { meshes, textures: this.textures };
	}
}

const rsm = (name, file, inst = {}, effect = {}) => ({
	name,
	effect: { type: 'RSM', file, ...effect },
	position: [12, 18, 0.25],
	startTick: 0,
	...inst
});

/** RSM entries covering every branch of legacy RsmEffect.js. */
export const RSM_SPAWNS = [
	rsm('static', 'effect\\static', {}, { size: 2 }),
	rsm('static-missing-texture', 'effect\\static_badtex'),
	rsm('spin', 'effect\\spin', { startTick: 30 }),
	rsm('spin-attached', 'effect\\spin', { attached: true, startTick: 0 }, { size: 0.5 }),
	rsm('regrow', 'effect\\regrow', { startTick: 37 }),
	rsm('stale-textures', 'effect\\stale', { startTick: 260 }),
	rsm('frozen', 'effect\\frozen'),
	rsm('missing-model', 'effect\\missing')
];

/** Discrepancy #56: an endTick legacy ignores (never sets needCleanUp). Not in RSM_SPAWNS. */
export const RSM_TIMED_SPAWNS = [rsm('timed', 'effect\\spin', { startTick: 0, endTick: 1500 })];

/**
 * Build legacy instances the way EffectManager.spamEffect / add do (positions copied
 * unless attached; needInit set).
 *
 * @param {Function} Ctor legacy RsmEffect
 * @param {Array} spawns
 * @param {object} owner entity followed by attached spawns
 */
export function spawnLegacy(Ctor, spawns, owner) {
	return spawns.map(spawn => {
		const position = spawn.attached ? owner.position : spawn.position.slice();
		const Params = { effect: spawn.effect, Inst: { position, startTick: spawn.startTick, endTick: spawn.endTick ?? -1 }, Init: {} };
		const effect = new Ctor(Params);
		effect.needInit = true;
		return { name: spawn.name, spawn, effect };
	});
}

/**
 * One EffectManager.render pass over a constructor's live instances.
 *
 * @param {object} gl
 * @param {Function} Ctor
 * @param {Array} live spawned instances
 * @param {number} tick
 * @param {object} fog
 * @param {function} [onRender] called after each instance's turn
 */
export function renderLegacyFrame(gl, Ctor, live, tick, fog, onRender) {
	Ctor.beforeRender(gl, IDENTITY, PROJECTION, fog, tick);
	for (const entry of live) {
		const { effect } = entry;
		if (!effect.ready && effect.needInit) {
			effect.init(gl, tick);
			effect.needInit = false;
		}
		const drawn = Boolean(effect.ready);
		if (drawn) {
			effect.render(gl, tick);
		}
		onRender?.(entry, tick, drawn);
	}
	Ctor.afterRender(gl);
}
