import { describe, expect, it } from 'vitest';
import { AnimatedRsmComposer, computeNodeMatrices, prepareAnimatedRsm } from '../../src/index.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const node = (fields = {}) => ({
	name: 'root',
	parentname: '',
	pos: [0, 0, 0],
	rotangle: 0,
	rotaxis: [0, 1, 0],
	scale: [1, 1, 1],
	offset: [0, 0, 0],
	mat3: IDENTITY3,
	...fields
});

const payload = (nodes, fields = {}) => ({
	filename: 'm.rsm',
	alpha: 1,
	instances: [IDENTITY],
	nodes,
	box: { center: [0, 0, 0], max: [0, 0, 0] },
	...fields
});

/** Matrix (column-major) applied to a point. */
const apply = (m, [x, y, z], at = 0) => [0, 1, 2].map(r => m[at + r] * x + m[at + 4 + r] * y + m[at + 8 + r] * z + m[at + 12 + r]);

describe('R-MAP-017 computeNodeMatrices', () => {
	it('composes the hierarchy, the box correction, the offset (unless only node) and mat3', () => {
		const model = payload(
			[
				node({ pos: [1, 0, 0] }),
				node({ name: 'child', parentname: 'root', pos: [0, 2, 0], offset: [0, 0, 3] }),
				node({ name: 'only', parentname: 'root', is_only: true, offset: [9, 9, 9], mat3: [2, 0, 0, 0, 2, 0, 0, 0, 2] })
			],
			{ instances: [IDENTITY, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]], box: { center: [0.5, 9, 0], max: [0, 4, 0] } }
		);
		const m = computeNodeMatrices(model, 0);
		expect(m).toHaveLength(3 * 2 * 16);
		const at = (n, i) => (n * 2 + i) * 16;
		expect(apply(m, [0, 0, 0], at(0, 0))).toEqual([0.5, -4, 0]);
		expect(apply(m, [0, 0, 0], at(1, 0))).toEqual([0.5, -2, 3]);
		expect(apply(m, [0, 0, 0], at(1, 1))).toEqual([100.5, -2, 3]);
		expect(apply(m, [1, 0, 0], at(2, 0))).toEqual([2.5, -4, 0]);
	});

	it('interpolates position keys and holds the last; a node parented to itself starts from identity', () => {
		const model = payload([
			node({
				parentname: 'root',
				posKeyframes: [
					{ frame: 0, px: 0, py: 0, pz: 0 },
					{ frame: 10, px: 10, py: 0, pz: 0 }
				]
			})
		]);
		const prepared = prepareAnimatedRsm(model);
		expect(prepared.animLen).toBe(11);
		expect(apply(computeNodeMatrices(prepared, 5), [0, 0, 0])).toEqual([5, 0, 0]);
		expect(apply(computeNodeMatrices(prepared, 50), [0, 0, 0])).toEqual([10, 0, 0]);
	});

	it('#69 FIX: before a first position key after frame 0 the first key is held (legacy: NaN)', () => {
		const model = payload([
			node({
				posKeyframes: [
					{ frame: 5, px: 1, py: 0, pz: 0 },
					{ frame: 10, px: 2, py: 0, pz: 0 }
				]
			}),
			node({ name: 'child', parentname: 'root', pos: [0, 3, 0] })
		]);
		const before = computeNodeMatrices(model, 2);
		expect(before.every(Number.isFinite)).toBe(true);
		expect(apply(before, [0, 0, 0], 0)).toEqual([1, 0, 0]);
		// the descendant inherits the clamped parent instead of NaN
		expect(apply(before, [0, 0, 0], 16)).toEqual([1, 3, 0]);
		expect(Array.from(computeNodeMatrices(model, 0))).toEqual(Array.from(computeNodeMatrices(model, 5)));
		// from the first key on, interpolation is unchanged
		expect(computeNodeMatrices(model, 5)[12]).toBe(1);
		expect(computeNodeMatrices(model, 7.5)[12]).toBe(1.5);
	});

	it('#69 FIX: rotation and scale keys hold their first key too (Frame field for scale)', () => {
		const half = Math.SQRT1_2;
		const model = payload([
			node({
				rotKeyframes: [
					{ frame: 4, q: [0, 0, half, half] },
					{ frame: 8, q: [0, 0, 0, 1] }
				],
				scaleKeyFrames: [
					{ Frame: 4, Scale: [2, 2, 2] },
					{ Frame: 8, Scale: [1, 1, 1] }
				]
			})
		]);
		const before = computeNodeMatrices(model, 1);
		expect(before.every(Number.isFinite)).toBe(true);
		expect(Array.from(before)).toEqual(Array.from(computeNodeMatrices(model, 4)));
		// 90° about z, scaled by 2: x → 2y
		expect(apply(before, [1, 0, 0]).map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 2, 0]);
	});

	it('#69 FIX matches the single-key clamp: a pre-key frame equals the model with only the first key', () => {
		const keys = [
			{ frame: 30, q: [0, 0.6, 0, 0.8] },
			{ frame: 60, q: [0, 0, 0, 1] }
		];
		const full = computeNodeMatrices(payload([node({ rotKeyframes: keys })]), 10);
		const single = computeNodeMatrices(payload([node({ rotKeyframes: keys.slice(0, 1) })]), 10);
		expect(Array.from(full).every((v, i) => Object.is(v, single[i]))).toBe(true);
	});

	it('marks the nodes before the first animated one as a static prefix', () => {
		const prepared = prepareAnimatedRsm(
			payload([node(), node({ name: 'b', rotKeyframes: [{ frame: 3, q: [0, 0, 0, 1] }] }), node({ name: 'c' })])
		);
		expect(prepared.nodes.map(n => n.isStatic)).toEqual([true, false, false]);
		expect(prepared.staticModel).toBe(false);
	});
});

describe('R-MAP-016 AnimatedRsmComposer', () => {
	it('recomputes only when the bucket changes, once for static models; ignores empty payloads', () => {
		const composer = new AnimatedRsmComposer();
		expect(composer.add(payload([]))).toBe(-1);
		const animated = payload(
			[node({ posKeyframes: [{ frame: 0, px: 0, py: 0, pz: 0 }, { frame: 1000, px: 1, py: 0, pz: 0 }] })],
			{ animLen: 1000 }
		);
		expect(composer.add(animated)).toBe(0);
		expect(composer.add(payload([node()], { filename: 'static.rsm' }))).toBe(1);
		const at = tick => composer.compose(tick).map(r => [r.params.updated, r.params.frame, r.params.animFrame]);
		expect(at(0)).toEqual([
			[false, 0, 0],
			[false, 0, 0]
		]);
		expect(at(37)).toEqual([
			[false, 0, 0],
			[false, 0, 0]
		]);
		expect(at(39)).toEqual([
			[true, 39, 1],
			[false, 0, 0]
		]);
		expect(at(1039)).toEqual([
			[false, 39, 1],
			[false, 0, 0]
		]);
		expect(composer.compose(5000, { performanceMode: true })[0].params).toMatchObject({ updated: true, animFrame: 0 });
		expect(composer.compose(5066, { performanceMode: true })[0].params).toMatchObject({ updated: false, animFrame: 0 });
		expect(composer.compose(5067, { performanceMode: true })[0].params).toMatchObject({ updated: true, animFrame: 1 });
		const [record] = composer.compose(5067);
		expect(record).toMatchObject({ kind: 'world', part: 'animatedModel', alpha: 1, params: { model: 0 } });
		expect(record.matrices).toHaveLength(16);
		composer.clear();
		expect(composer.compose(0)).toEqual([]);
	});
});
