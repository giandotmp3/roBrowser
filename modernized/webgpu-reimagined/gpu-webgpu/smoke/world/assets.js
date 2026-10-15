/**
 * Synthetic map of the world parity page: a 16×16-tile GND (32×32 cells) and its GAT,
 * built as binaries and parsed + compiled by the REAL legacy loaders (Loaders/Ground.js,
 * Loaders/Altitude.js) into the MAP_GROUND / MAP_ALTITUDE payloads; the MAP_WORLD
 * payload (RSW light and water, as World.compile returns it); the MAP_MODELS payload
 * (static RSM meshes merged and sorted as Loaders/MapLoader.js mergeMeshes does) and
 * two MAP_ANIMATED_MODEL payloads serialised as MapLoader.sendAnimatedModels does,
 * from the root suite's RSM fixtures (tests/renderer/support/rsmEffectScene.js MODELS).
 *
 * Every image is a PNG data URL (legacy Texture.load revokes blob URLs once loaded, so
 * the two sides cannot share one): ground textures (one with magenta keys, one not
 * 256 px, one translucent-edged), 32 water frames, model textures of several size
 * classes (stretched to POT on upload: 100×60, 40×56, …), and grid.tga.
 */
import GND from 'Loaders/Ground.js';
import GAT from 'Loaders/Altitude.js';
import { rng } from '../entities/assets.js';
import { MODELS } from '../../../../../tests/renderer/support/rsmEffectScene.js';

/** Map size in GND tiles (each tile is 2×2 GAT cells). */
export const GND_SIZE = 16;
export const CELLS = GND_SIZE * 2;

/** RSW water (World.compile values: level and wave height already /5). */
export const WATER = Object.freeze({
	level: 0.6,
	type: 0,
	waveHeight: 0.35,
	waveSpeed: 2,
	wavePitch: 50,
	animSpeed: 3
});

/** RSW light (World.compile values). */
export const LIGHT = Object.freeze({
	longitude: 60,
	latitude: 40,
	diffuse: [0.95, 0.85, 0.75],
	ambient: [0.3, 0.32, 0.38],
	opacity: 0.7
});

/**
 * Terrain height (world units, RO's inverted Y: positive is lower) at a corner in GAT
 * cell coordinates: rolling hills, a basin that fills with water, a raised plateau.
 * @param {number} x
 * @param {number} z
 */
export function heightAt(x, z) {
	const hills = 0.9 * Math.sin(x * 0.35) * Math.cos(z * 0.27) - 0.4 * Math.sin((x + z) * 0.21);
	const bx = x - 9;
	const bz = z - 22;
	const basin = 2.6 * Math.exp(-(bx * bx + bz * bz) / 30);
	const plateau = x > 20 && z < 10 ? -1.2 : 0;
	return Math.round((hills + basin + plateau) * 40) / 40;
}

/** Ground textures, by GND texture name. */
const GROUND_TEXTURES = Object.freeze([
	{ name: 'ground/grass.bmp', width: 256, height: 256, look: 'grass', seed: 11 },
	{ name: 'ground/rock.bmp', width: 256, height: 256, look: 'rock', seed: 12 },
	{ name: 'ground/sand.bmp', width: 128, height: 128, look: 'sand', seed: 13 },
	{ name: 'ground/flowers.bmp', width: 256, height: 256, look: 'keyed', seed: 14 },
	{ name: 'ground/path.tga', width: 200, height: 180, look: 'edge', seed: 15 }
]);

/** Static RSM textures (several POT classes after the stretch). */
export const MODEL_TEXTURES = Object.freeze([
	{ name: 'model/wall.bmp', width: 128, height: 128, look: 'rock', seed: 21 },
	{ name: 'model/roof.bmp', width: 100, height: 60, look: 'keyed', seed: 22 },
	{ name: 'model/wood.bmp', width: 64, height: 64, look: 'sand', seed: 23 },
	{ name: 'model/leaf.tga', width: 40, height: 56, look: 'edge', seed: 24 },
	{ name: 'model/banner.tga', width: 256, height: 64, look: 'edge', seed: 25 },
	{ name: 'model/stone.bmp', width: 128, height: 128, look: 'grass', seed: 26 }
]);

/** Animated RSM textures (rsmEffectScene MODELS use these names). */
const ANIMATED_TEXTURES = Object.freeze([
	{ name: 'effect/ice.bmp', width: 32, height: 32, look: 'keyed', seed: 31 },
	{ name: 'effect/stone.bmp', width: 50, height: 30, look: 'rock', seed: 32 },
	{ name: 'effect/fire.bmp', width: 40, height: 20, look: 'edge', seed: 33 }
]);

/** RGBA pixels of one texture. */
function paint({ width, height, look, seed }) {
	const random = rng(seed);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width;
			const v = (y + 0.5) / height;
			const n = random();
			const block = ((x >> 4) + (y >> 4) * 5 + seed) % 9;
			let rgba;
			if (look === 'grass') {
				rgba = [40 + 60 * n, 110 + 90 * v, 30 + 40 * u, 255];
			} else if (look === 'rock') {
				const g = 90 + 100 * n * (block % 2 ? 1 : 0.6);
				rgba = [g, g * 0.95, g * 0.9, 255];
			} else if (look === 'sand') {
				rgba = [200 + 40 * n, 170 + 50 * u, 110 + 40 * v, 255];
			} else if (look === 'keyed') {
				rgba =
					block === 0
						? [255, 0, 255, 255]
						: block === 4
							? [245, 12, 238, 255]
							: [200 * u + 30, 60 + 120 * n, 220 * v, 255];
			} else {
				// translucent edges and holes: exercises the 0.1 ground cutout and the 0 model discard
				const dx = u - 0.5;
				const dy = v - 0.5;
				const d = Math.sqrt(dx * dx + dy * dy);
				const a = block === 3 ? 0 : Math.round(255 * Math.min(1, Math.max(0, (0.62 - d) * 3)));
				rgba = [230 * u + 20, 200 * (1 - v) + 40, 100 + 120 * n, a];
			}
			data.set(
				rgba.map(c => Math.round(c)),
				(y * width + x) * 4
			);
		}
	}
	return new ImageData(data, width, height);
}

/** PNG data URL of a painted texture. */
function dataUrl(spec) {
	const canvas = document.createElement('canvas');
	canvas.width = spec.width;
	canvas.height = spec.height;
	canvas.getContext('2d').putImageData(paint(spec), 0, 0);
	return canvas.toDataURL('image/png');
}

/** 32 water frames: a moving caustic pattern, opaque (water ignores texture alpha). */
function waterFrame(i) {
	const size = 64;
	const data = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const w = Math.sin(((x + i * 2) / size) * Math.PI * 4) * Math.cos(((y - i) / size) * Math.PI * 6);
			data.set([30 + 40 * w, 90 + 50 * w, 170 + 60 * w, 128 + 100 * w].map(Math.round), (y * size + x) * 4);
		}
	}
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	canvas.getContext('2d').putImageData(new ImageData(data, size, size), 0, 0);
	return canvas.toDataURL('image/png');
}

/** Little-endian binary writer. */
function writer(size) {
	const view = new DataView(new ArrayBuffer(size));
	let o = 0;
	return {
		u8: v => view.setUint8(o++, v),
		u16: v => {
			view.setUint16(o, v, true);
			o += 2;
		},
		u32: v => {
			view.setUint32(o, v >>> 0, true);
			o += 4;
		},
		i32: v => {
			view.setInt32(o, v, true);
			o += 4;
		},
		f32: v => {
			view.setFloat32(o, v, true);
			o += 4;
		},
		str: (s, len) => {
			for (let i = 0; i < len; i++) {
				view.setUint8(o++, i < s.length ? s.charCodeAt(i) : 0);
			}
		},
		get buffer() {
			return view.buffer;
		},
		get offset() {
			return o;
		}
	};
}

/** Lightmaps: 8×8 shadow bytes + 8×8 rgb bytes each, varied. */
function lightmapBytes(count) {
	const random = rng(77);
	const out = new Uint8Array(count * 256);
	for (let i = 0; i < count; i++) {
		for (let p = 0; p < 64; p++) {
			const px = p % 8;
			const py = p >> 3;
			out[i * 256 + p] = Math.round(120 + 135 * Math.abs(Math.sin((px + i) * 0.7 + py * 0.3)));
			const base = i * 256 + 64 + p * 3;
			out[base] = Math.round(40 * random() + (i % 3) * 20);
			out[base + 1] = Math.round(30 * random() + (i % 5) * 9);
			out[base + 2] = Math.round(25 * random() + 7 * (py % 4));
		}
	}
	return out;
}

/** The GND binary (version 1.7: water comes from the RSW). */
function buildGnd() {
	const random = rng(5);
	const lightmapCount = 21;
	const tiles = [];
	const surfaces = [];
	const tile = (texture, light, color, quarter = 0) => {
		const u0 = (quarter % 2) * 0.5;
		const v0 = Math.floor(quarter / 2) * 0.5;
		tiles.push({
			u: [u0, u0 + 0.5, u0, u0 + 0.5],
			v: [v0, v0, v0 + 0.5, v0 + 0.5],
			texture,
			light,
			color
		});
		return tiles.length - 1;
	};
	const corner = (x, y) => heightAt(x * 2, y * 2) * 5;
	for (let y = 0; y < GND_SIZE; y++) {
		for (let x = 0; x < GND_SIZE; x++) {
			const hole = (x === 3 && y === 12) || (x === 14 && y === 2);
			const texture = (x * 7 + y * 3) % GROUND_TEXTURES.length;
			const light = (x + y * 5) % lightmapCount;
			// BGRA tile colours; mostly opaque white-ish, some tinted, one translucent
			const color =
				(x + y) % 6 === 0
					? [120, 200, 255, 255]
					: (x * y) % 11 === 5
						? [255, 255, 255, 140]
						: [230 + Math.floor(random() * 25), 240, 250, 255];
			const up = hole ? -1 : tile(texture, light, color, (x + 2 * y) % 4);
			const h = [corner(x, y), corner(x + 1, y), corner(x, y + 1), corner(x + 1, y + 1)];
			// walls where the next tile drops (front: y + 1, right: x + 1)
			const front = y + 1 < GND_SIZE && (x + y) % 5 === 1;
			const right = x + 1 < GND_SIZE && (x * 3 + y) % 7 === 2;
			surfaces.push({
				h,
				up,
				front: front
					? tile((texture + 1) % GROUND_TEXTURES.length, (light + 3) % lightmapCount, [200, 220, 240, 255], 1)
					: -1,
				right: right
					? tile((texture + 2) % GROUND_TEXTURES.length, (light + 5) % lightmapCount, [255, 255, 255, 255], 2)
					: -1
			});
		}
	}
	const lightmaps = lightmapBytes(lightmapCount);
	const nameLen = 40;
	const size =
		4 +
		2 +
		12 +
		8 +
		GROUND_TEXTURES.length * nameLen +
		16 +
		lightmaps.length +
		4 +
		tiles.length * 40 +
		surfaces.length * 28;
	const w = writer(size);
	w.str('GRGN', 4);
	w.u8(1);
	w.u8(7);
	w.u32(GND_SIZE);
	w.u32(GND_SIZE);
	w.f32(10);
	w.u32(GROUND_TEXTURES.length);
	w.u32(nameLen);
	GROUND_TEXTURES.forEach(t => w.str(t.name, nameLen));
	w.i32(lightmapCount);
	w.i32(8);
	w.i32(8);
	w.i32(1);
	lightmaps.forEach(b => w.u8(b));
	w.u32(tiles.length);
	for (const t of tiles) {
		t.u.forEach(w.f32);
		t.v.forEach(w.f32);
		w.u16(t.texture);
		w.u16(t.light);
		t.color.forEach(w.u8);
	}
	for (const s of surfaces) {
		s.h.forEach(w.f32);
		w.i32(s.up);
		w.i32(s.front);
		w.i32(s.right);
	}
	if (w.offset !== size) {
		throw new Error(`GND size ${w.offset} != ${size}`);
	}
	return w.buffer;
}

/** The GAT binary: corner heights of the same terrain; a few non-walkable cells. */
export function isBlocked(x, y) {
	return (x >= 14 && x <= 15 && y >= 15 && y <= 17) || (x + y * 3) % 23 === 0;
}

function buildGat() {
	const w = writer(14 + CELLS * CELLS * 20);
	w.str('GRAT', 4);
	w.u8(1);
	w.u8(2);
	w.u32(CELLS);
	w.u32(CELLS);
	for (let y = 0; y < CELLS; y++) {
		for (let x = 0; x < CELLS; x++) {
			[heightAt(x, y), heightAt(x + 1, y), heightAt(x, y + 1), heightAt(x + 1, y + 1)].forEach(h => w.f32(h * 5));
			w.u32(isBlocked(x, y) ? 1 : 0);
		}
	}
	return w.buffer;
}

/**
 * A box mesh (5 faces, no bottom) standing on the terrain at cell (x, z): 9 floats per
 * vertex (position, flat normal, uv, alpha). `uvMax` > 1 exercises CLAMP_TO_EDGE.
 */
function box({ x, z, sx, sz, height, uvMax = 1, alpha = 1, skew = 0 }) {
	const base = heightAt(x, z) + 0.05;
	const top = base - height;
	const p = (dx, y, dz) => [x + dx + (y === top ? skew : 0), y, z + dz];
	const quads = [
		// front (−z), back (+z), left (−x), right (+x), top
		[p(-sx, base, -sz), p(sx, base, -sz), p(sx, top, -sz), p(-sx, top, -sz)],
		[p(sx, base, sz), p(-sx, base, sz), p(-sx, top, sz), p(sx, top, sz)],
		[p(-sx, base, sz), p(-sx, base, -sz), p(-sx, top, -sz), p(-sx, top, sz)],
		[p(sx, base, -sz), p(sx, base, sz), p(sx, top, sz), p(sx, top, -sz)],
		[p(-sx, top, -sz), p(sx, top, -sz), p(sx, top, sz), p(-sx, top, sz)]
	];
	const out = [];
	for (const q of quads) {
		const a = q[0];
		const b = q[1];
		const c = q[2];
		const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
		const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		const len = Math.hypot(...n) || 1;
		const normal = n.map(c2 => c2 / len);
		const uv = [
			[0, uvMax],
			[uvMax, uvMax],
			[uvMax, 0],
			[0, 0]
		];
		for (const i of [0, 1, 2, 2, 3, 0]) {
			out.push(...q[i], ...normal, ...uv[i], alpha);
		}
	}
	return new Float32Array(out);
}

/** Static RSM placements: texture index into MODEL_TEXTURES, geometry, model alpha. */
const STATIC_MODELS = Object.freeze([
	{ texture: 0, x: 12, z: 9, sx: 1.6, sz: 1.2, height: 3.2 },
	{ texture: 0, x: 19, z: 18, sx: 1.2, sz: 2.2, height: 2.4 },
	{ texture: 1, x: 12, z: 9, sx: 1.8, sz: 1.4, height: 3.6, uvMax: 1.4 },
	{ texture: 2, x: 7, z: 14, sx: 0.8, sz: 0.8, height: 4.5, skew: 0.6 },
	{ texture: 3, x: 17, z: 12, sx: 1.4, sz: 0.25, height: 2.2, alpha: 0.6 },
	{ texture: 4, x: 22, z: 15, sx: 1.9, sz: 0.3, height: 1.6, uvMax: 1.25 },
	{ texture: 5, x: 15, z: 21, sx: 1.1, sz: 1.1, height: 1.4 },
	{ texture: 5, x: 24, z: 7, sx: 1.4, sz: 1.0, height: 2.0, alpha: 0.8 },
	{ texture: 2, x: 9, z: 6, sx: 0.6, sz: 1.5, height: 1.2 }
]);

/** Loaders/MapLoader.js SortMeshByTextures (kept verbatim: .tga last, then alpha, then name). */
function sortMeshByTextures(a, b) {
	const regTga = /\.tga$/i;
	if (a.texture.match(regTga)) {
		return 1;
	}
	if (b.texture.match(regTga)) {
		return -1;
	}
	if (a.alpha !== b.alpha) {
		return a.alpha < b.alpha ? 1 : -1;
	}
	if (a.texture < b.texture) {
		return -1;
	}
	if (a.texture > b.texture) {
		return 1;
	}
	return 0;
}

/** Loaders/MapLoader.js mergeMeshes: sort, concatenate, one info per texture run. */
function mergeMeshes(objects, urls) {
	const size = objects.reduce((n, o) => n + o.mesh.length, 0);
	const buffer = new Float32Array(size);
	const infos = [];
	let offset = 0;
	let texture;
	objects.sort(sortMeshByTextures);
	for (const object of objects) {
		if (texture === object.texture) {
			infos[infos.length - 1].vertCount += object.mesh.length / 9;
		} else {
			texture = object.texture;
			infos.push({ filename: texture, vertOffset: offset / 9, vertCount: object.mesh.length / 9 });
		}
		buffer.set(object.mesh, offset);
		offset += object.mesh.length;
	}
	for (const info of infos) {
		info.texture = urls.get(info.filename);
	}
	return { buffer, infos };
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A column-major instance matrix: T(position)·RotY(yaw)·Scale(s, −s, s) (RSM y points down). */
function instanceMatrix([x, z], yawDeg, s) {
	const r = (yawDeg * Math.PI) / 180;
	const c = Math.cos(r);
	const n = Math.sin(r);
	return [c * s, 0, -n * s, 0, 0, -s, 0, 0, n * s, 0, c * s, 0, x, heightAt(x, z), z, 1];
}

/**
 * MAP_ANIMATED_MODEL payloads (MapLoader.sendAnimatedModels shape) from rsmEffectScene
 * MODELS: 'spin' (3 nodes: rotation slerp, position and scale keys, smooth groups,
 * mat3, is_only) and 'stale' (scale keys, a static second node).
 */
function animatedPayloads() {
	const nodeNames = ['root', 'arm', 'tip'];
	// The fixtures count keyframes in frames of a short loop; legacy reads the tick (ms) as
	// the frame (R-MAP-016), so the loop and keyframes are stretched by `msPerFrame` to
	// animate over a few hundred ms.
	const stretch = (keys, msPerFrame) =>
		keys.map(k => ({
			...k,
			...(k.frame !== undefined ? { frame: k.frame * msPerFrame } : {}),
			...(k.Frame !== undefined ? { Frame: k.Frame * msPerFrame } : {})
		}));
	const make = (file, { shadeType, alpha, instances, msPerFrame }) => {
		const desc = MODELS[file];
		return {
			filename: file,
			animLen: desc.animLen * msPerFrame,
			frameRatePerSecond: desc.frameRatePerSecond || 30,
			shadeType,
			alpha,
			textures: desc.textures.slice(),
			instances,
			nodes: desc.nodes.map((node, i) => ({
				name: nodeNames[i],
				parentname: i === 0 ? '' : nodeNames[i - 1],
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
	};
	return [
		make('data\\model\\effect\\spin.rsm', {
			shadeType: 2,
			alpha: 1,
			msPerFrame: 60,
			instances: [instanceMatrix([14, 15], 20, 0.9), instanceMatrix([20, 10], -35, 0.7)]
		}),
		make('data\\model\\effect\\stale.rsm', {
			shadeType: 1,
			alpha: 0.75,
			msPerFrame: 100,
			instances: [instanceMatrix([10, 17], 70, 1.1)]
		})
	];
}

/**
 * Build every payload and image of the scene.
 * @returns {{
 *   world: object, ground: object, altitude: object, models: object, animated: object[],
 *   files: Map<string, string>, gatCompiled: object, gnd: object
 * }}
 */
export function buildWorldAssets() {
	const urls = new Map();
	for (const t of [...GROUND_TEXTURES, ...MODEL_TEXTURES]) {
		urls.set(`data\\texture\\${t.name}`, dataUrl(t));
	}
	const files = new Map();
	for (const t of ANIMATED_TEXTURES) {
		files.set(`data\\texture\\${t.name}`, dataUrl(t));
	}
	files.set('data/texture/grid.tga', dataUrl({ width: 32, height: 32, look: 'edge', seed: 41 }));

	// MAP_ALTITUDE (Loaders/Altitude.js compile)
	const gat = new GAT(buildGat());
	const altitude = gat.compile();

	// MAP_WORLD (World.compile) + MAP_GROUND (Ground.compile + texture data, MapLoader)
	const world = {
		water: { ...WATER, splitWidth: 0, splitHeight: 0, images: Array.from({ length: 32 }, (_, i) => waterFrame(i)) },
		light: { ...LIGHT, diffuse: [...LIGHT.diffuse], ambient: [...LIGHT.ambient] },
		sound: [],
		effect: []
	};
	const gnd = new GND(buildGnd());
	const ground = gnd.compile(world.water.level, world.water.waveHeight);
	ground.textures = gnd.textures.map(name => urls.get(`data\\texture\\${name}`));

	// MAP_MODELS
	const objects = STATIC_MODELS.map(m => ({
		texture: `data\\texture\\${MODEL_TEXTURES[m.texture].name}`,
		alpha: m.alpha ?? 1,
		mesh: box(m)
	}));
	const models = mergeMeshes(objects, urls);

	return { world, ground, altitude, models, animated: animatedPayloads(), files, gnd };
}
