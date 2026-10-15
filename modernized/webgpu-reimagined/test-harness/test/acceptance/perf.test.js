/** AI_NATIVE_SPEC §5.10 — PERF: culling and quality (4 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run } from '../support/scenes.js';
import { mob, gr2Mob } from '../../src/scenes/fixtures.js';
import { lastFrame, sprites, world } from '../../src/subject/queries.js';

const G = 120_700_000;

describe('PERF', () => {
	rule(
		'R-PERF-001',
		'perf mode: entities > viewArea (squared XY) skipped in every pass incl. GR2 and picking, decided once per frame',
		async s => {
			const r = await run(
				s,
				inGame('perf-001', { prefs: { performanceMode: true, viewArea: 14 } })
					.entity(mob({ gid: G + 1, position: [35, 20, 0] }))
					.entity(gr2Mob('empelium90_0', { gid: G + 2, position: [20, 35, 0] }))
					.entity(mob({ gid: G + 3, position: [30, 20, 0] }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(sprites(f, { gid: G + 1 })).toHaveLength(0);
			expect(f.records.filter(x => x.owner?.gid === G + 2)).toHaveLength(0);
			expect(f.pickRects.find(p => p.gid === G + 1)).toBeUndefined();
			expect(sprites(f, { gid: G + 3 }).length).toBeGreaterThan(0);
			expect(f.cullDecisions).toBe(1);
		}
	);

	rule(
		'R-PERF-002',
		'perf mode: effect radius = viewArea, sort every 6 frames, trails halved, RSM fps/2, bloom 1/8, scene .75×',
		async s => {
			const r = await run(
				s,
				inGame('perf-002', { prefs: { performanceMode: true, viewArea: 14, bloom: true } }).frames(12, 16)
			);
			const f = lastFrame(r);
			expect(f.perf).toMatchObject({
				effectCullRadius: 14,
				sortEvery: 6,
				maxTrails: 2,
				animatedRsmDivisor: 2,
				bloomScale: 0.125,
				sceneScale: 0.75
			});
		}
	);

	rule(
		'R-PERF-003',
		'enableMipmap → LINEAR_MIPMAP_LINEAR + mips on world/ground/damage textures; else LINEAR, no mips',
		async s => {
			const on = await run(s, inGame('perf-003', { config: { enableMipmap: true } }).advance(16));
			expect(world(lastFrame(on), 'ground').meta.sampler).toEqual({
				min: 'linear',
				mipmap: 'linear',
				mips: true
			});
			const off = await run(s, inGame('perf-003-off').advance(16));
			expect(world(lastFrame(off), 'ground').meta.sampler).toEqual({
				min: 'linear',
				mipmap: 'none',
				mips: false
			});
		}
	);

	rule(
		'R-PERF-004',
		'static RSM merged by texture over contiguous ranges once textures load (fixes draw order)',
		async s => {
			const models = {
				buffer: 'fixture',
				infos: [
					{ filename: 'a', texture: 't1', vertOffset: 0, vertCount: 3 },
					{ filename: 'b', texture: 't1', vertOffset: 3, vertCount: 3 },
					{ filename: 'c', texture: 't2', vertOffset: 6, vertCount: 3 }
				]
			};
			const r = await run(s, inGame('perf-004').worker('MAP_MODELS', models).advance(16));
			const ranges = world(lastFrame(r), 'static-models').meta.ranges;
			expect(ranges).toEqual([
				{ texture: 't1', first: 0, count: 6 },
				{ texture: 't2', first: 6, count: 3 }
			]);
		}
	);
});
