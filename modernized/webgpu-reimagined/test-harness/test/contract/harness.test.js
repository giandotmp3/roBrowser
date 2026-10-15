/** Harness contract: scene scripts, fixtures, subject port, queries, goldens, perceptual compare. */
import { describe, it, expect } from 'vitest';
import { scene, SceneOp } from '../../src/scenes/SceneScript.js';
import { flatMap, pc, resetGids, nextGid } from '../../src/scenes/fixtures.js';
import { PARITY_SCENES, divergenceOptions } from '../../src/scenes/catalog.js';
import { NotImplementedSubject, resolveSubject } from '../../src/subject/SubjectPort.js';
import { passOrder, inPass, sprites, lastFrame } from '../../src/subject/queries.js';
import { GOLDENS, goldenMatrix, Backend } from '../../src/golden/GoldenSet.js';
import { compareImages } from '../../src/golden/perceptual.js';
import { RULES } from '../../src/rules/catalog.js';
import { spriteDraw, passMarker } from '../../src/records/RecordTypes.js';
import { HarnessContractError, NotImplementedError } from '../../src/errors.js';

describe('SceneScript', () => {
	it('builds a frozen, JSON-serialisable script', () => {
		const s = scene('t', 7)
			.viewport({ width: 1, height: 1 })
			.map('m', flatMap({ width: 2, height: 2 }))
			.entity(pc({ gid: 1 }))
			.frames(3)
			.build();
		expect(Object.isFrozen(s.steps)).toBe(true);
		expect(s.seed).toBe(7);
		expect(s.steps.map(x => x.op)).toEqual([SceneOp.VIEWPORT, SceneOp.MAP, SceneOp.ENTITY_ADD, SceneOp.ADVANCE]);
		expect(JSON.parse(JSON.stringify(s))).toEqual(s);
		expect(() => scene().step('nope')).toThrow(HarnessContractError);
		expect(() => scene().entity({})).toThrow(HarnessContractError);
	});

	it('fixtures are synthetic and deterministic', () => {
		resetGids();
		const a = nextGid();
		resetGids();
		expect(nextGid()).toBe(a);
		expect(flatMap({ width: 3, height: 2 }).cells).toHaveLength(6);
		expect(JSON.stringify(pc({ full: true }))).not.toMatch(/password|passwd|secret|token|https?:\/\//i);
	});

	it('parity scenes build and declare only flagged-rule divergences', () => {
		const flagged = new Set(RULES.filter(r => r.flagged).map(r => r.id));
		for (const def of PARITY_SCENES) {
			expect(def.build().steps.length).toBeGreaterThan(0);
			Object.keys(def.divergences).forEach(id => expect(flagged.has(id)).toBe(true));
			expect(() => divergenceOptions(def)).not.toThrow();
		}
	});
});

describe('SubjectPort', () => {
	it('defaults to NotImplementedSubject when no adapter is configured', async () => {
		const s = await resolveSubject({ env: {} });
		expect(s).toBeInstanceOf(NotImplementedSubject);
		await expect(s.run({ name: 'x' })).rejects.toBeInstanceOf(NotImplementedError);
		await expect(s.fragment('ground')).rejects.toBeInstanceOf(NotImplementedError);
		await expect(s.cpu('altitude.height')).rejects.toBeInstanceOf(NotImplementedError);
	});
});

describe('queries', () => {
	it('slice frames by pass and owner', () => {
		const frame = {
			records: [
				passMarker('entities'),
				spriteDraw({ owner: { gid: 1, type: 'pc' }, layer: 'body' }),
				passMarker('water'),
				spriteDraw({ layer: 'x' })
			]
		};
		expect(passOrder(frame)).toEqual(['entities', 'water']);
		expect(inPass(frame, 'entities')).toHaveLength(1);
		expect(sprites(frame, { gid: 1 })).toHaveLength(1);
		expect(() => lastFrame({ frames: [] })).toThrow();
	});
});

describe('GoldenSet', () => {
	it('has ~12 goldens, bloom on WebGPU only, every rule cited exists', () => {
		expect(GOLDENS.length).toBe(12);
		const known = new Set(RULES.map(r => r.id));
		GOLDENS.forEach(g => g.rules.forEach(id => expect(known.has(id)).toBe(true)));
		const bloom = GOLDENS.filter(g => g.rules.includes('R-PP-004'));
		bloom.forEach(g => expect(g.backends).toEqual([Backend.WEBGPU]));
		expect(goldenMatrix()).toHaveLength(11 * 2 + 1);
	});
});

describe('compareImages', () => {
	const img = (w, h, rgba) => ({
		width: w,
		height: h,
		data: new Uint8Array(Array.from({ length: w * h }, () => rgba).flat())
	});

	it('identical passes; small perceptual noise passes; large change fails', () => {
		expect(compareImages(img(4, 4, [10, 20, 30, 255]), img(4, 4, [10, 20, 30, 255])).pass).toBe(true);
		expect(compareImages(img(4, 4, [100, 100, 100, 255]), img(4, 4, [102, 101, 100, 255])).pass).toBe(true);
		const r = compareImages(img(4, 4, [0, 0, 0, 255]), img(4, 4, [255, 255, 255, 255]));
		expect(r.pass).toBe(false);
		expect(r.ratio).toBe(1);
	});

	it('size mismatch fails with a reason', () => {
		expect(compareImages(img(2, 2, [0, 0, 0, 0]), img(3, 2, [0, 0, 0, 0]))).toMatchObject({
			pass: false,
			reason: expect.stringMatching(/size/)
		});
	});
});
