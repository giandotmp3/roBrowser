/** AI_NATIVE_SPEC §5.11 — GR2: 3D skeletal mobs (6 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run } from '../support/scenes.js';
import { gr2Mob, flatMap } from '../../src/scenes/fixtures.js';
import { lastFrame, worlds, sprites } from '../../src/subject/queries.js';

const G = 120_800_000;
const gr2Of = (f, gid) => worlds(f, { layer: 'gr2' }).filter(w => w.meta?.gid === gid);

describe('GR2', () => {
	rule(
		'R-GR2-001',
		'roster only; flag D 100/255 A = Rec.601 grey of map ambient; others D 128/255 A 127/255; else Poring sprite',
		async s => {
			const map = flatMap({
				light: { longitude: 0, latitude: 0, diffuse: [1, 1, 1], ambient: [0.3, 0.6, 0.9], opacity: 1 }
			});
			const r = await run(
				s,
				inGame('gr2-001', { map })
					.entity(gr2Mob('guildflag90_1', { gid: G + 1 }))
					.entity(gr2Mob('kguardian90_7', { gid: G + 2 }))
					.entity(gr2Mob('not_in_roster', { gid: G + 3 }))
					.advance(16)
			);
			const f = lastFrame(r);
			const flag = gr2Of(f, G + 1)[0].uniforms;
			expect(flag.diffuse).toBeCloseTo(100 / 255, 6);
			expect(flag.ambient).toBeCloseTo(0.299 * 0.3 + 0.587 * 0.6 + 0.114 * 0.9, 4);
			const guard = gr2Of(f, G + 2)[0].uniforms;
			expect(guard).toMatchObject({ diffuse: 128 / 255, ambient: 127 / 255 });
			expect(gr2Of(f, G + 3)).toHaveLength(0);
			expect(sprites(f, { gid: G + 3 }).find(x => x.layer === 'body').meta.fallback).toBe('poring');
		}
	);

	rule(
		'R-GR2-002',
		'alpha < 207/255 discarded, rest opaque; no blend unless fading; depth test+write; no lightmap/occluder',
		async s => {
			expect(await s.fragment('gr2', { tex: [1, 1, 1, 206 / 255], fading: false })).toBeNull();
			const kept = await s.fragment('gr2', { tex: [1, 1, 1, 207 / 255], fading: false });
			expect(kept[3]).toBe(1);
			const r = await run(
				s,
				inGame('gr2-002')
					.entity(gr2Mob('empelium90_0', { gid: G + 4 }))
					.advance(16)
			);
			expect(gr2Of(lastFrame(r), G + 4)[0].depth).toMatchObject({ test: true, write: true });
		}
	);

	rule(
		'R-GR2-003',
		'poses quantised to 40 Hz, cached per (path, anim, t); clock restarts on action change; ≤48 bones; one frame behind',
		async s => {
			const r = await run(
				s,
				inGame('gr2-003')
					.entity(gr2Mob('empelium90_0', { gid: G + 5 }))
					.frames(6, 10)
			);
			const ts = r.frames.map(f => gr2Of(f, G + 5)[0].meta.poseTime);
			ts.forEach(t => expect((t * 40) % 1000).toBeCloseTo(0, 6));
			r.frames.forEach(f => expect(gr2Of(f, G + 5)[0].meta.bones).toBeLessThanOrEqual(48));
			r.frames.slice(1).forEach((f, i) => expect(gr2Of(f, G + 5)[0].meta.stateFrame).toBe(r.frames[i].index));
		}
	);

	rule(
		'R-GR2-004',
		'yaw = dir·45°; frustum-culled by ground anchor with 0.2 NDC margin; culled entity → no pose, no draw',
		async s => {
			const r = await run(
				s,
				inGame('gr2-004')
					.entity(gr2Mob('empelium90_0', { gid: G + 6, direction: 3 }))
					.entity(gr2Mob('empelium90_0', { gid: G + 7, position: [200, 200, 0] }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(gr2Of(f, G + 6)[0].meta.yaw).toBe(135);
			expect(gr2Of(f, G + 7)).toHaveLength(0);
		}
	);

	rule('R-GR2-005', 'death/vanish pop instantly; only effectColor alpha applies; no shadow blob', async s => {
		const r = await run(
			s,
			inGame('gr2-005')
				.entity(gr2Mob('empelium90_0', { gid: G + 8 }))
				.advance(16)
				.removeEntity(G + 8, 'death')
				.advance(16)
		);
		expect(gr2Of(r.frames[0], G + 8)).toHaveLength(1);
		expect(sprites(r.frames[0], { gid: G + 8 }).filter(x => x.layer === 'shadow')).toHaveLength(0);
		expect(gr2Of(r.frames[1], G + 8)).toHaveLength(0);
	});

	rule(
		'R-GR2-006',
		'emblem: A4R4G4B4, 24 → 32 px POT, magenta key ≥248/<8/≥248; submesh skipped until loaded',
		async s => {
			const e = await s.cpu('gr2.emblem', { width: 24, height: 24, fill: [250, 5, 250, 255] });
			expect(e).toMatchObject({ format: 'rgba4', width: 32, height: 32 });
			expect(e.texel(0, 0)).toEqual([0, 0, 0, 0]);
			const r = await run(
				s,
				inGame('gr2-006')
					.entity(gr2Mob('guildflag90_1', { gid: G + 9, emblem: null }))
					.advance(16)
			);
			expect(gr2Of(lastFrame(r), G + 9)[0].meta.skippedSubmeshes).toContain('emblem');
		}
	);
});
