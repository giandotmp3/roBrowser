/**
 * RsmEffect: EffectTable 'RSM' / 'RSM2' models into EffectDraw records. Field-by-field
 * parity (vertices included) with legacy Renderer/Effects/RsmEffect.js is proved in the
 * root suite (tests/renderer/RecordDiff.rsmEffect.test.js).
 */
import { describe, expect, it } from 'vitest';
import { BLEND_NORMAL, RSM_VERTEX_STRIDE, RsmEffect, rsmMergeMeshes, rsmNodeMeshAtFrame, rsmNodePose } from '../../src/index.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** One-triangle node on texture 0. */
function triangleNode(fields = {}) {
	return {
		main: { box: { center: [0, 0, 0], max: [0, 0, 0] }, alpha: 0.5, shadeType: 0 },
		pos: [0, 0, 0],
		rotangle: 0,
		rotaxis: [0, 0, 0],
		scale: [1, 1, 1],
		offset: [0, 0, 0],
		is_only: true,
		mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
		vertices: [
			[0, 0, 0],
			[1, 0, 0],
			[0, 0, 1]
		],
		tvertices: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]),
		faces: [{ vertidx: [0, 1, 2], tvertidx: [0, 1, 2], texid: 0, smoothGroup: 0 }],
		textures: [0],
		rotKeyframes: [],
		posKeyframes: [],
		scaleKeyFrames: [],
		...fields
	};
}

/** Minimal loader stand-in: identity instance, compile = mesh at frame 0. */
function model(nodes, extra = {}) {
	return {
		textures: ['effect/a.bmp', 'effect/b.bmp'],
		nodes,
		instances: [],
		createInstance() {
			this.instances.push(IDENTITY);
		},
		compile() {
			return { meshes: this.nodes.map(n => rsmNodeMeshAtFrame(n, IDENTITY, 0, 1)), textures: this.textures };
		},
		...extra
	};
}

describe('RsmEffect', () => {
	it('draws one record per object with the pass state (normal alpha, depth on) and scene fog', () => {
		const effect = new RsmEffect({ size: 2 }, { position: [3, 4, 5] }, { model: model([triangleNode()]) });
		const [r] = effect.frame(0, { sceneFog: { use: true } });
		expect(r).toMatchObject({
			kind: 'effect',
			family: 'rsm',
			pass: 'after',
			texture: 'data/texture/effect/a.bmp',
			position: [3, 4, 5],
			depthTest: true,
			depthWrite: true,
			fog: true,
			params: { object: 0, size: 2, frame: null, vertOffset: 0, vertCount: 3 }
		});
		expect(r.blend).toBe(BLEND_NORMAL);
		// shade type 0: normals (0, −1, 0); alpha per vertex
		expect(Array.from(r.params.vertices.slice(0, RSM_VERTEX_STRIDE))).toEqual([0, 0, 0, 0, -1, 0, 0, 0, 0.5]);
	});

	it('rebuilds keyframed models when the frame changes', () => {
		const node = triangleNode({
			posKeyframes: [
				{ frame: 0, px: 0, py: 0, pz: 0 },
				{ frame: 10, px: 2, py: 0, pz: 0 }
			]
		});
		const effect = new RsmEffect({}, { position: [0, 0, 0], startTick: 0 }, { model: model([node], { animLen: 20, frameRatePerSecond: 10 }) });
		const at = tick => effect.frame(tick)[0];
		expect(at(500).params.frame).toBe(5);
		expect(at(500).params.vertices[0]).toBeCloseTo(1);
		expect(at(1500).params.frame).toBe(15);
		// wraps from the last key back to the first over animLen
		expect(at(1500).params.vertices[0]).toBeCloseTo(1);
	});

	it('flat shading rotates the face normal with the node', () => {
		const node = triangleNode({ main: { box: { center: [0, 0, 0], max: [0, 0, 0] }, alpha: 1, shadeType: 1 } });
		const mesh = rsmNodeMeshAtFrame(node, IDENTITY, 0, 1)[0];
		expect(Array.from(mesh.slice(3, 6))).toEqual([0, -1, 0].map(v => v + 0));
		expect(rsmNodePose(node, 0, 1)).toEqual({ rotation: null, position: null, scale: null });
	});

	it('merges meshes node-major with texture keys ascending', () => {
		const { buffer, objects } = rsmMergeMeshes(
			[{ 1: new Float32Array(9), 0: new Float32Array(18) }, { 1: new Float32Array(9) }],
			['x', 'y']
		);
		expect(buffer).toHaveLength(36);
		expect(objects).toEqual([
			{ texture: 'data/texture/x', vertOffset: 0, vertCount: 2 },
			{ texture: 'data/texture/y', vertOffset: 2, vertCount: 1 },
			{ texture: 'data/texture/y', vertOffset: 3, vertCount: 1 }
		]);
	});
});
