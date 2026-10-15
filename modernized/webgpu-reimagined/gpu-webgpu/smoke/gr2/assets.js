/**
 * Synthetic GR2 models for the gr2 parity page. The repository ships no .gr2 file (and
 * no GRF), so each model is built directly in the shape granny-ro-js `parseAll` returns
 * (skeletons, textured meshes with bone bindings and vertex weights, embedded textures,
 * animations with LegacyCurve32f tracks, models[0].initialPlacement). The real
 * Loaders/GR2Loader.js packs it, the real granny-ro-js `poseAt` poses it, and the real
 * legacy GR2ModelRenderer draws it (see gr2/granny.js for the parse seam).
 *
 * Granny units are Z-up (the legacy world matrix applies Rx(+90°)·Ry·S(0.2)·T), about
 * 5 units per map cell. Five rostered models:
 *
 * - guildflag90_1: 41 bones (root, 8 pole, 4×8 cloth), pole + cloth (own alpha, an edge
 *   ramp across 207/255) + Plane01 emblem plane; embedded waving standby.
 * - empelium90_0: 4 bones, a crystal whose opaque texture carries magenta stripes (keyed).
 * - kguardian90_7 / aguardian90_8 / sguardian90_9: 8 bones, body and arms; external
 *   banks attack / damage / dead / move; kguardian has a translated InitialPlacement.
 * - treasurebox_2: 3 bones, rotated InitialPlacement, banks dead / damage; a texture
 *   with no pixels (grey 200) and a submesh with no matching texture (grey 180/185).
 */

const ID_SCALE_SHEAR = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const TAU = Math.PI * 2;

/** Seeded RNG (mulberry32). */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const quat = (axis, angle) => {
	const s = Math.sin(angle / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

/** Bones from [name, parentName|null, localPos]; bind orientations are identity. */
function skeleton(list) {
	const index = new Map();
	const world = [];
	const bones = list.map(([name, parent, local], i) => {
		index.set(name, i);
		const p = parent === null ? -1 : index.get(parent);
		const w = p < 0 ? local : local.map((v, k) => v + world[p][k]);
		world.push(w);
		return {
			index: i,
			name,
			parentIndex: p,
			transform: { flags: 3, position: [...local], orientation: [0, 0, 0, 1], scaleShear: [...ID_SCALE_SHEAR] },
			inverseWorldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1]
		};
	});
	return { name: 'skel', lodType: 0, bones, local: new Map(list.map(([n, , l]) => [n, l])) };
}

const linearCurve = (dimension, knots, controls) => ({
	codec: 'LegacyCurve32f',
	format: -1,
	degree: 1,
	dimension,
	knotControlCount: knots.length * 2,
	sampleValue: new Float32Array(dimension),
	knots: new Float32Array(knots),
	controls: new Float32Array(controls.flat())
});

/**
 * An animation: per bone, rotation keys [t, axis, angle] (linear quaternion curve) and a
 * constant position curve at the bind local position.
 */
function animation(name, duration, skel, rotations) {
	const tracks = [];
	for (const [boneName, keys] of Object.entries(rotations)) {
		const local = skel.local.get(boneName);
		tracks.push({
			index: tracks.length,
			name: boneName,
			flags: 0,
			orientationCurve: linearCurve(
				4,
				keys.map(k => k[0]),
				keys.map(([, axis, angle]) => quat(axis, angle))
			),
			positionCurve: linearCurve(3, [0, duration], [local, local]),
			scaleShearCurve: null
		});
	}
	return {
		index: 0,
		name,
		duration,
		timeStep: 0,
		oversampling: 1,
		defaultLoopCount: 0,
		flags: 0,
		trackGroupNames: [name],
		trackGroups: [
			{
				index: 0,
				name,
				vectorTrackCount: 0,
				transformTrackCount: tracks.length,
				textTrackCount: 0,
				accumulationFlags: 0,
				loopTranslation: 0,
				vectorTrackNames: [],
				transformTracks: tracks
			}
		]
	};
}

/** Sinusoidal rotation keys: n+1 keys over `duration`, amplitude `amp` around `axis`. */
const wave = (duration, axis, amp, phase = 0, n = 8) =>
	Array.from({ length: n + 1 }, (_, i) => [(duration * i) / n, axis, amp * Math.sin((TAU * i) / n + phase)]);
/** Linear ramp keys from angle a to b. */
const ramp = (duration, axis, a, b) => [
	[0, axis, a],
	[duration, axis, b]
];

/**
 * A tube around an axis through bone-weighted rings.
 * @param {{name: string, texFile: string, bones: string[], sides: number, rings: {pos: number[], radius: number, weights: [string, number][]}[], axis?: 'z'|'x', emblem?: boolean}} spec
 */
function tube({ name, texFile, bones, sides, rings, axis = 'z' }) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const vertexWeights = [];
	const indices = [];
	const local = new Map(bones.map((b, i) => [b, i]));
	rings.forEach((ring, k) => {
		for (let s = 0; s <= sides; s++) {
			const a = (TAU * s) / sides;
			const c = Math.cos(a);
			const d = Math.sin(a);
			const offset = axis === 'z' ? [c, d, 0] : [0, c, d];
			positions.push(ring.pos.map((v, i) => v + offset[i] * ring.radius));
			normals.push(offset);
			uvs.push([s / sides, k / (rings.length - 1)]);
			vertexWeights.push(ring.weights.map(([bone, weight]) => ({ boneIndex: local.get(bone), weight })));
		}
	});
	const row = sides + 1;
	for (let k = 0; k < rings.length - 1; k++) {
		for (let s = 0; s < sides; s++) {
			const a = k * row + s;
			indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
		}
	}
	return mesh(name, texFile, bones, { positions, normals, uvs, vertexWeights, indices });
}

/** A flat grid in the XZ plane at depth y; weights(i, j) gives the vertex weights. */
function grid({ name, texFile, bones, x0, x1, z0, z1, y, cols, rows, weights }) {
	const positions = [];
	const normals = [];
	const uvs = [];
	const vertexWeights = [];
	const indices = [];
	const local = new Map(bones.map((b, i) => [b, i]));
	for (let j = 0; j <= rows; j++) {
		for (let i = 0; i <= cols; i++) {
			positions.push([x0 + ((x1 - x0) * i) / cols, y, z1 - ((z1 - z0) * j) / rows]);
			normals.push([0, -1, 0]);
			uvs.push([i / cols, j / rows]);
			vertexWeights.push(weights(i, j).map(([bone, weight]) => ({ boneIndex: local.get(bone), weight })));
		}
	}
	const row = cols + 1;
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			const a = j * row + i;
			indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
		}
	}
	return mesh(name, texFile, bones, { positions, normals, uvs, vertexWeights, indices });
}

function mesh(name, texFile, bones, g) {
	return {
		name,
		vertexCount: g.positions.length,
		positions: g.positions,
		normals: g.normals,
		uvs: g.uvs,
		vertexWeights: g.vertexWeights,
		indices: g.indices,
		boneBindings: bones.map(b => ({ name: b })),
		materials: [{ textureFile: texFile }]
	};
}

/** RGBA texture from a per-texel function. */
function texture(name, width, height, fn) {
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			pixels.set(
				fn(x, y).map(v => Math.max(0, Math.min(255, Math.round(v)))),
				(y * width + x) * 4
			);
		}
	}
	return { name, width, height, pixels };
}

// ------------------------------------------------------------------ models

function guildFlag() {
	const list = [['root', null, [0, 0, 0]]];
	for (let i = 1; i <= 8; i++) {
		list.push([`p${i}`, i === 1 ? 'root' : `p${i - 1}`, [0, 0, 3]]);
	}
	// cloth: 4 rows × 8 columns, each row a chain along +x hanging off the pole
	const clothRowZ = [21, 18, 15, 12];
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 8; c++) {
			const parent = c === 0 ? `p${7 - r}` : `c${r}_${c - 1}`;
			const parentZ = c === 0 ? 3 * (7 - r) : clothRowZ[r];
			list.push([`c${r}_${c}`, parent, c === 0 ? [0.6, 0, clothRowZ[r] - parentZ] : [2, 0, 0]]);
		}
	}
	const skel = skeleton(list);
	const poleBones = ['root', ...Array.from({ length: 8 }, (_, i) => `p${i + 1}`)];
	const pole = tube({
		name: 'Pole',
		texFile: 'pole.bmp',
		bones: poleBones,
		sides: 8,
		rings: Array.from({ length: 9 }, (_, k) => ({
			pos: [0, 0, 3 * k],
			radius: k === 8 ? 0.2 : 0.6,
			weights: [[poleBones[k], 1]]
		}))
	});
	const clothBones = [];
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 8; c++) {
			clothBones.push(`c${r}_${c}`);
		}
	}
	const clothWeights = (i, j) => {
		const r = Math.min(3, Math.floor(j / 1.25));
		const c = Math.min(7, Math.floor(i / 2));
		const prev = Math.max(0, c - 1);
		return i % 2
			? [[`c${r}_${c}`, 1]]
			: [
					[`c${r}_${c}`, 0.7],
					[`c${r}_${prev}`, 0.3]
				];
	};
	const cloth = grid({
		name: 'Cloth',
		texFile: 'flag.tga',
		bones: clothBones,
		x0: 0.6,
		x1: 16.6,
		z0: 10.5,
		z1: 22.5,
		y: 0,
		cols: 16,
		rows: 5,
		weights: clothWeights
	});
	const plane = grid({
		name: 'Plane01',
		texFile: 'emblem.bmp',
		bones: clothBones,
		x0: 4,
		x1: 12,
		z0: 13,
		z1: 21,
		y: -0.3,
		cols: 4,
		rows: 4,
		weights: (i, j) => clothWeights(i * 2 + 2, Math.min(5, j + 1))
	});
	const rand = rng(11);
	const textures = [
		texture('pole.bmp', 16, 60, (x, y) => [120 + 40 * Math.sin(y / 3), 80 + 20 * (x % 4), 40, 255]),
		// own alpha: an edge ramp crossing 207/255 at the fly end, plus a magenta texel kept verbatim
		texture('flag.tga', 64, 30, (x, y) => {
			if (x === 20 && y === 10) {
				return [255, 0, 255, 255];
			}
			const stripe = (Math.floor(y / 6) + Math.floor(x / 16)) % 2;
			const alpha = x < 48 ? 255 : 255 - (x - 48) * 9 - rand() * 4;
			return stripe ? [200, 30, 40, alpha] : [240, 220, 120, alpha];
		})
	];
	const stand = animation('stand', 1.6, skel, {
		...Object.fromEntries(clothBones.map((b, k) => [b, wave(1.6, [0, 0, 1], 0.12 + 0.01 * (k % 8), (k % 8) * 0.6)]))
	});
	return { skel, meshes: [pole, cloth, plane], textures, animations: [stand], placement: null };
}

function emperium() {
	const skel = skeleton([
		['root', null, [0, 0, 0]],
		['e1', 'root', [0, 0, 4]],
		['e2', 'e1', [0, 0, 4]],
		['e3', 'e2', [0, 0, 4]]
	]);
	const radii = [0.4, 2, 3.2, 3.5, 3.2, 2, 0.3];
	const bones = ['root', 'e1', 'e2', 'e3'];
	const crystal = tube({
		name: 'Crystal',
		texFile: 'emp.bmp',
		bones,
		sides: 6,
		rings: radii.map((radius, k) => ({
			pos: [0, 0, 2 + 2 * k],
			radius,
			weights: [
				[bones[Math.min(3, Math.floor(k / 2))], 0.75],
				[bones[Math.min(3, Math.floor(k / 2) + 1)], 0.25]
			]
		}))
	});
	const textures = [
		// opaque: magenta stripes keyed (≥ 248, < 8, ≥ 248) to holes
		texture('emp.bmp', 40, 24, (x, y) =>
			(x + 2 * y) % 13 < 2 ? [252, 3, 250, 255] : [60 + 4 * x, 120 + 5 * y, 230, 255]
		)
	];
	const stand = animation('stand', 2, skel, {
		root: [
			[0, [0, 0, 1], 0],
			[1, [0, 0, 1], Math.PI],
			[2, [0, 0, 1], TAU]
		],
		e2: wave(2, [1, 0, 0], 0.15)
	});
	return { skel, meshes: [crystal], textures, animations: [stand], placement: null };
}

function guardian(seed, tint) {
	const skel = skeleton([
		['root', null, [0, 0, 0]],
		['hip', 'root', [0, 0, 5]],
		['spine', 'hip', [0, 0, 5]],
		['head', 'spine', [0, 0, 5]],
		['armL', 'spine', [2.5, 0, 3]],
		['foreL', 'armL', [4, 0, 0]],
		['armR', 'spine', [-2.5, 0, 3]],
		['foreR', 'armR', [-4, 0, 0]]
	]);
	const bodyBones = ['root', 'hip', 'spine', 'head'];
	const body = tube({
		name: 'Body',
		texFile: 'guard.bmp',
		bones: bodyBones,
		sides: 10,
		rings: [0, 2.5, 5, 7.5, 10, 12.5, 15, 17, 19].map((z, k) => ({
			pos: [0, 0, z],
			radius: [1.6, 1.8, 2.2, 2.6, 2.4, 1.2, 1.4, 1.5, 0.4][k],
			weights:
				z < 5
					? [
							['root', 1 - z / 5],
							['hip', z / 5]
						]
					: z < 10
						? [
								['hip', 1 - (z - 5) / 5],
								['spine', (z - 5) / 5]
							]
						: z < 15
							? [
									['spine', 1 - (z - 10) / 5],
									['head', (z - 10) / 5]
								]
							: [['head', 1]]
		}))
	});
	const arm = side => {
		const s = side === 'L' ? 1 : -1;
		return tube({
			name: `Arm${side}`,
			texFile: 'metal.tga',
			bones: [`arm${side}`, `fore${side}`],
			sides: 6,
			axis: 'x',
			rings: [0, 2, 4, 6, 8].map((d, k) => ({
				pos: [s * (2.5 + d), 0, 13],
				radius: [0.9, 0.8, 0.8, 0.7, 0.5][k],
				weights: d < 4 ? [[`arm${side}`, 1]] : [[`fore${side}`, 1]]
			}))
		});
	};
	const rand = rng(seed);
	const textures = [
		texture('guard.bmp', 56, 48, (x, y) => {
			if (y > 40 && x % 9 < 2) {
				return [255, 0, 255, 255]; // keyed holes (fully opaque image)
			}
			const n = rand() * 20;
			return [tint[0] + n + (y % 8) * 4, tint[1] + n, tint[2] + (x % 7) * 5, 255];
		}),
		// own alpha: a gradient crossing the 207/255 alpha ref, kept verbatim (not keyed)
		texture('metal.tga', 30, 18, (x, y) => [170 + 2 * x, 170 + 3 * y, 190, 160 + x * 3.2])
	];
	const stand = animation('stand', 2.4, skel, {
		spine: wave(2.4, [1, 0, 0], 0.06),
		head: wave(2.4, [0, 0, 1], 0.25, 1)
	});
	const banks = {
		attack: animation('attack', 0.8, skel, {
			armR: [
				[0, [0, 1, 0], 0],
				[0.3, [0, 1, 0], -1.2],
				[0.6, [0, 1, 0], 0.5],
				[0.8, [0, 1, 0], 0]
			],
			foreR: ramp(0.8, [0, 0, 1], 0, 0.9),
			spine: wave(0.8, [0, 0, 1], 0.3, 0, 4)
		}),
		damage: animation('damage', 0.5, skel, {
			spine: [
				[0, [1, 0, 0], 0],
				[0.15, [1, 0, 0], -0.4],
				[0.5, [1, 0, 0], 0]
			],
			head: ramp(0.5, [1, 0, 0], 0, -0.3)
		}),
		dead: animation('dead', 0.7, skel, {
			root: ramp(0.7, [1, 0, 0], 0, 1.4),
			armL: ramp(0.7, [0, 1, 0], 0, 0.8),
			armR: ramp(0.7, [0, 1, 0], 0, -0.8)
		}),
		move: animation('move', 1, skel, {
			hip: wave(1, [0, 0, 1], 0.2, 0, 6),
			armL: wave(1, [0, 0, 1], 0.6, 0, 6),
			armR: wave(1, [0, 0, 1], 0.6, Math.PI, 6),
			root: wave(1, [1, 0, 0], 0.08, 0, 6)
		})
	};
	return { skel, meshes: [body, arm('L'), arm('R')], textures, animations: [stand], banks };
}

function treasureBox() {
	const skel = skeleton([
		['root', null, [0, 0, 0]],
		['lid', 'root', [0, -2.5, 4]],
		['lock', 'root', [0, -3, 2.5]]
	]);
	const box = tube({
		name: 'Box',
		texFile: 'box.bmp',
		bones: ['root'],
		sides: 4,
		rings: [0, 2, 4].map(z => ({ pos: [0, 0, z], radius: 3.5, weights: [['root', 1]] }))
	});
	const lid = tube({
		name: 'Lid',
		texFile: 'lid.bmp',
		bones: ['lid'],
		sides: 4,
		rings: [4, 5.2].map((z, k) => ({ pos: [0, 0, z], radius: k ? 2.6 : 3.6, weights: [['lid', 1]] }))
	});
	const lock = tube({
		name: 'Lock',
		texFile: 'nothere.bmp',
		bones: ['lock'],
		sides: 5,
		axis: 'x',
		rings: [-0.6, 0.6].map(x => ({ pos: [x, -2.8, 2.6], radius: 0.6, weights: [['lock', 1]] }))
	});
	const textures = [
		texture('box.bmp', 33, 21, (x, y) => [140 + (x % 5) * 10, 90 + (y % 4) * 12, 40, 255]),
		{ name: 'lid.bmp', width: 8, height: 8, pixels: null }
	];
	const stand = animation('stand', 3, skel, { lock: wave(3, [0, 1, 0], 0.3) });
	const banks = {
		dead: animation('dead', 0.6, skel, { lid: ramp(0.6, [1, 0, 0], 0, -1.1) }),
		damage: animation('damage', 0.4, skel, { root: wave(0.4, [0, 0, 1], 0.2, 0, 4) })
	};
	return {
		skel,
		meshes: [box, lid, lock],
		textures,
		animations: [stand],
		banks,
		placement: { flags: 2, position: [0, 0, 0], orientation: quat([0, 0, 1], 0.5), scaleShear: [...ID_SCALE_SHEAR] }
	};
}

const BUILDERS = {
	guildflag90_1: guildFlag,
	empelium90_0: emperium,
	kguardian90_7: () => ({
		...guardian(71, [90, 90, 120]),
		placement: { flags: 1, position: [0, -4, 0], orientation: [0, 0, 0, 1], scaleShear: [...ID_SCALE_SHEAR] }
	}),
	aguardian90_8: () => ({ ...guardian(81, [70, 130, 70]), placement: null }),
	sguardian90_9: () => ({ ...guardian(91, [140, 80, 60]), placement: null }),
	treasurebox_2: treasureBox
};
const SET_ID = { kguardian90_7: 7, aguardian90_8: 8, sguardian90_9: 9, treasurebox_2: 2 };

export const MODEL_PATHS = Object.freeze(
	Object.fromEntries(Object.keys(BUILDERS).map(name => [name, `data/model/3dmob/${name}.gr2`]))
);

/** A fresh `parseAll` result for a model (legacy grafts banks into it, so never shared). */
export function parsedModel(name) {
	const m = BUILDERS[name]();
	return {
		skeletons: [{ name: m.skel.name, lodType: 0, bones: m.skel.bones }],
		meshes: m.meshes,
		textures: m.textures,
		animations: m.animations,
		models: [{ name, initialPlacement: m.placement ?? { flags: 0 } }]
	};
}

/** A fresh `parseAnimated` result for a bank: its one animation as animations[0]. */
export function parsedBank(name, action) {
	const m = BUILDERS[name]();
	return { skeletons: [], meshes: [], animations: [m.banks[action]] };
}

/**
 * The archive: path → ArrayBuffer. A "file" is a small JSON tag the parse seam
 * (gr2/granny.js) turns back into the synthetic parse result.
 */
export function buildGr2Files() {
	const enc = new TextEncoder();
	const files = new Map();
	for (const [name, path] of Object.entries(MODEL_PATHS)) {
		files.set(path, enc.encode(JSON.stringify({ model: name })).buffer);
		const m = BUILDERS[name]();
		for (const action of Object.keys(m.banks ?? {})) {
			files.set(
				`data/model/3dmob_bone/${SET_ID[name]}_${action}.gr2`,
				enc.encode(JSON.stringify({ model: name, bank: action })).buffer
			);
		}
	}
	return files;
}
