/** AI_NATIVE_SPEC §5.8 — PICK: picking and selection (7 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, LOCAL_GID } from '../support/scenes.js';
import { mob, npc, pc, gr2Mob, flatMap } from '../../src/scenes/fixtures.js';
import { lastFrame } from '../../src/subject/queries.js';

const G = 120_500_000;

describe('PICK', () => {
	rule(
		'R-PICK-001',
		'ray from mouse through far plane, 1-unit steps ≤200, first in-map |h+y|<0.5 hits; outside skipped',
		async s => {
			const out = await s.cpu('altitude.rayMarch', {
				map: flatMap({ width: 10, height: 10 }),
				origin: [5, 10, 5],
				dir: [0, -1, 0]
			});
			expect(out.steps).toBeLessThanOrEqual(200);
			expect(out.hit).toEqual([5, 5]);
			expect(
				(
					await s.cpu('altitude.rayMarch', {
						map: flatMap({ width: 10, height: 10 }),
						origin: [-50, 10, -50],
						dir: [0, 0, -1]
					})
				).hit
			).toBeNull();
		}
	);

	rule(
		'R-PICK-002',
		'Mouse.world reset to −1 each frame then set; PACKETVER ≥ 20200101 swaps DEFAULT/NOWALK',
		async s => {
			const map = flatMap({ walkable: x => x !== 25 });
			const r = await run(
				s,
				inGame('pick-002', { map })
					.packetver(20200101)
					.input({ type: 'mousemove', worldCell: [25, 20] })
					.advance(16)
					.input({ type: 'mousemove', offscreen: true })
					.advance(16)
			);
			expect(r.frames[0].mouse.cursor).toBe('NOWALK');
			expect(r.frames[1].mouse.world).toEqual({ x: -1, y: -1, z: -1 });
			const old = await run(
				s,
				inGame('pick-002-old', { map })
					.packetver(20190101)
					.input({ type: 'mousemove', worldCell: [25, 20] })
					.advance(16)
			);
			expect(lastFrame(old).mouse.cursor).toBe('DEFAULT');
		}
	);

	rule(
		'R-PICK-003',
		'rect from body extents ×size/175 through lifted billboard; min 60 px (30 items); default ±25, 0..45; job 139 none',
		async s => {
			const r = await run(
				s,
				inGame('pick-003')
					.entity(mob({ gid: G + 1, views: {} }))
					.entity(mob({ gid: G + 2, job: 139 }))
					.advance(16)
			);
			const f = lastFrame(r);
			const def = f.pickRects.find(p => p.gid === G + 1);
			expect(def.x1 - def.x0).toBeGreaterThanOrEqual(60);
			expect(f.pickRects.find(p => p.gid === G + 2)).toBeUndefined();
		}
	);

	rule(
		'R-PICK-004',
		'sort by depth − priority·100; mob 3 > item 2 > NPC 1 > PC 0 > effect −1; support mode PC 3 > mob 2 > pet 1',
		async s => {
			const sc = inGame('pick-004')
				.entity(npc({ gid: G + 3, position: [22, 20, 0] }))
				.entity(mob({ gid: G + 4, position: [22, 20, 0] }))
				.input({ type: 'mousemove', overGid: G + 3 });
			const r = await run(s, sc.advance(16));
			expect(lastFrame(r).hover.gid).toBe(G + 4);
			const sup = await run(
				s,
				inGame('pick-004-s')
					.session({ playing: true, localGid: LOCAL_GID, supportSkillMode: true })
					.entity(pc({ gid: G + 5, position: [22, 20, 0] }))
					.entity(mob({ gid: G + 6, position: [22, 20, 0] }))
					.input({ type: 'mousemove', overGid: G + 5 })
					.advance(16)
			);
			expect(lastFrame(sup).hover.gid).toBe(G + 5);
		}
	);

	rule('R-PICK-005', 'not pickable: dead non-PC, being removed, beyond viewArea in perf mode', async s => {
		const r = await run(
			s,
			inGame('pick-005', { prefs: { performanceMode: true, viewArea: 14 } })
				.entity(mob({ gid: G + 12, position: [21, 20, 0] }))
				.entity(mob({ gid: G + 7, action: 'die' }))
				.entity(mob({ gid: G + 8, position: [38, 20, 0] }))
				.entity(mob({ gid: G + 9 }))
				.removeEntity(G + 9, 'out-of-sight')
				.advance(16)
		);
		const ids = lastFrame(r)
			.pickRects.filter(p => p.pickable)
			.map(p => p.gid);
		expect(ids).toContain(G + 12); // positive control: a live, near mob stays pickable
		expect(ids).not.toContain(G + 7);
		expect(ids).not.toContain(G + 8);
		expect(ids).not.toContain(G + 9);
	});

	rule('R-PICK-006', 'hover recomputed every frame; out/over on target change or Shift change', async s => {
		const r = await run(
			s,
			inGame('pick-006')
				.entity(mob({ gid: G + 10, position: [22, 20, 0] }))
				.input({ type: 'mousemove', overGid: G + 10 })
				.advance(16)
				.advance(16)
				.input({ type: 'key', key: 'Shift', down: true })
				.advance(16)
		);
		expect(r.frames[0].hover.events).toEqual([{ type: 'over', gid: G + 10 }]);
		expect(r.frames[1].hover.events).toEqual([]);
		expect(r.frames[2].hover.events).toEqual([
			{ type: 'out', gid: G + 10 },
			{ type: 'over', gid: G + 10 }
		]);
	});

	rule('R-PICK-007', 'GR2 pick area: square at the base sphere (~lower 46% of a guild flag)', async s => {
		const r = await run(
			s,
			inGame('pick-007')
				.entity(gr2Mob('guildflag90_1', { gid: G + 11, position: [22, 20, 0] }))
				.advance(16)
		);
		const rect = lastFrame(r).pickRects.find(p => p.gid === G + 11);
		expect(rect.meta.source).toBe('gr2-base-sphere');
		expect(rect.meta.coverage).toBeCloseTo(0.46, 1);
	});
});
