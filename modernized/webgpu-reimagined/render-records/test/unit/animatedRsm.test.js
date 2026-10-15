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

	it('legacy parity: before a first key after frame 0 the matrices are NaN', () => {
		const model = payload([node({ posKeyframes: [{ frame: 5, px: 1, py: 0, pz: 0 }, { frame: 10, px: 2, py: 0, pz: 0 }] })]);
		expect(Number.isNaN(computeNodeMatrices(model, 2)[12])).toBe(true);
		expect(computeNodeMatrices(model, 5)[12]).toBe(1);
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
