/** AI_NATIVE_SPEC §5.6 — DMG: damage numbers (9 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run } from '../support/scenes.js';
import { mob } from '../../src/scenes/fixtures.js';
import { lastFrame, damages, sprites, effects } from '../../src/subject/queries.js';

const G = 120_300_000;
const withMob = (name, o) => inGame(name, o).entity(mob({ gid: G, position: [22, 20, 0] }));

describe('DMG', () => {
	rule('R-DMG-001', 'lifetime 1500 (combo 3000); SP/heal/PC-hit/crit colours; α = 1 − elapsed/delay', async s => {
		const r = await run(
			s,
			withMob('dmg-001').damage({ amount: 100, gid: G, type: 'normal' }).advance(750, 1).advance(800, 1)
		);
		const d = damages(r.frames[0])[0];
		expect(d.color).toEqual([1, 1, 1, 0.5]);
		expect(damages(r.frames[1])).toHaveLength(0);
		const sp = await run(s, withMob('dmg-001-sp').damage({ amount: 5, gid: G, type: 'sp' }).advance(1));
		expect(damages(lastFrame(sp))[0].color.slice(0, 3)).toEqual([0.13, 0.19, 0.75]);
		const crit = await run(s, withMob('dmg-001-crit').damage({ amount: 5, gid: G, type: 'crit' }).advance(1));
		expect(damages(lastFrame(crit), { damageType: 'crit' })[0].color.slice(0, 3)).toEqual([0.9, 0.9, 0.15]);
	});

	rule(
		'R-DMG-002',
		'normal: pos + (4p, −4p), z + 2 + 5 sin(−π/2 + π(.5 + 1.5p)), scale (1−p)·4; motions 1/2/3',
		async s => {
			const r = await run(s, withMob('dmg-002').damage({ amount: 100, gid: G, type: 'normal' }).advance(750, 1));
			const p = 0.5;
			const d = damages(lastFrame(r))[0];
			expect(d.position[0]).toBeCloseTo(22 + 4 * p + 0.5, 3);
			expect(d.scale).toBeCloseTo((1 - p) * 4, 3);
			expect(d.position[2]).toBeCloseTo(20 - 4 * p + 0.5, 3);
			expect(-d.position[1]).toBeCloseTo(2 + 5 * Math.sin(-Math.PI / 2 + Math.PI * (0.5 + 1.5 * p)), 3);
		}
	);

	rule('R-DMG-003', 'heal: scale max((1−2p)·3, .8); z +2, rising (p−.4)·5 after 40%', async s => {
		const r = await run(
			s,
			withMob('dmg-003').damage({ amount: 100, gid: G, type: 'heal' }).advance(300, 1).advance(600, 1)
		);
		expect(damages(r.frames[0])[0].scale).toBeCloseTo(Math.max((1 - 0.4) * 3, 0.8), 3);
		expect(damages(r.frames[1])[0].scale).toBeCloseTo(0.8, 3);
	});

	rule(
		'R-DMG-004',
		'Miss/Lucky live exactly as long as visible: 800 ms (legacy: invisible 800–1500 ms); Miss only with `miss` pref',
		async s => {
			const r = await run(
				s,
				withMob('dmg-004', { prefs: { miss: true } })
					.damage({ amount: 0, gid: G, type: 'miss' })
					.frames(100, 16)
			);
			// present and visible for its 800 ms motion, then removed (no invisible tail)
			const live = r.frames.filter(f => f.tick < 800);
			expect(live.length).toBeGreaterThan(25);
			live.forEach(f => expect(damages(f, { damageType: 'miss' })).toHaveLength(1));
			r.frames
				.filter(f => f.tick >= 800)
				.forEach(f => expect(damages(f, { damageType: 'miss' })).toHaveLength(0));
			for (const f of r.frames) {
				const m = damages(f, { damageType: 'miss' });
				m.forEach(d => {
					expect(d.scale).toBeGreaterThan(0);
					expect(d.color[3]).toBeGreaterThan(0);
				});
			}
			const off = await run(
				s,
				withMob('dmg-004-off', { prefs: { miss: false } })
					.damage({ amount: 0, gid: G, type: 'miss' })
					.advance(16)
			);
			expect(damages(lastFrame(off), { damageType: 'miss' })).toHaveLength(0);
		}
	);

	rule(
		'R-DMG-005',
		'combo: scale min(p, .05)·70, z +7+p; only newest per entity; non-final hidden after 15%',
		async s => {
			const r = await run(
				s,
				withMob('dmg-005')
					.damage({ amount: 10, gid: G, type: 'combo' })
					.damage({ amount: 20, gid: G, type: 'combo' })
					.advance(300, 1)
					.advance(300, 1)
			);
			expect(damages(r.frames[0], { damageType: 'combo' })).toHaveLength(1);
			expect(damages(r.frames[0], { damageType: 'combo' })[0].scale).toBeCloseTo(
				Math.min(300 / 3000, 0.05) * 70,
				3
			);
			expect(damages(r.frames[1], { damageType: 'combo' })).toHaveLength(0); // 600/3000 = 20% > 15%
		}
	);

	rule('R-DMG-006', 'crit: critbg 0.6 scale, 0.66 grey, (0,−6), behind number; spawns effect 1', async s => {
		const r = await run(s, withMob('dmg-006').damage({ amount: 100, gid: G, type: 'crit' }).advance(1));
		const f = lastFrame(r);
		const bg = damages(f, { damageType: 'critbg' })[0];
		expect(bg.scale).toBeCloseTo(0.6, 6);
		expect(bg.color.slice(0, 3)).toEqual([0.66, 0.66, 0.66]);
		expect(f.records.indexOf(bg)).toBeLessThan(f.records.indexOf(damages(f, { damageType: 'crit' })[0]));
		expect(effects(f, { effectId: 1 }).length).toBeGreaterThan(0);
	});

	rule(
		'R-DMG-007',
		'glyphs 2 px padding, POT×DPR; floored; negatives ignored; suffix ≥1e8 → /1e6 M, ≥1e6 → /1e3 K',
		async s => {
			expect(await s.cpu('records.damageText', { amount: 12.9 })).toBe('12');
			expect(await s.cpu('records.damageText', { amount: -5 })).toBeNull();
			expect(await s.cpu('records.damageText', { amount: 2e8, enableDmgSuffix: true })).toBe('200M');
			expect(await s.cpu('records.damageText', { amount: 2.5e6, enableDmgSuffix: true })).toBe('2500K');
			const layout = await s.cpu('records.damageGlyphLayout', { text: '12', dpr: 2 });
			expect(layout.padding).toBe(2);
			expect(Math.log2(layout.width / 2) % 1).toBe(0);
		}
	);

	rule('R-DMG-008', 'skins 0..3; 3 suppresses numbers; PACKETVER < 20220821 forces 0', async s => {
		const inv = await run(
			s,
			withMob('dmg-008', { prefs: { damageSkin: 3 } })
				.packetver(20230101)
				.damage({ amount: 1, gid: G, type: 'normal' })
				.advance(1)
		);
		expect(damages(lastFrame(inv))).toHaveLength(0);
		const old = await run(
			s,
			withMob('dmg-008-old', { prefs: { damageSkin: 2 } })
				.packetver(20200101)
				.damage({ amount: 1, gid: G, type: 'normal' })
				.advance(1)
		);
		expect(damages(lastFrame(old))[0].skin).toBe(0);
	});

	rule(
		'R-DMG-009',
		'damage after entities, depth test off, bias = list index; bias does not leak into the next frame',
		async s => {
			const r = await run(
				s,
				withMob('dmg-009')
					.damage({ amount: 1, gid: G, type: 'normal' })
					.damage({ amount: 2, gid: G, type: 'normal' })
					.advance(1)
					.advance(16)
			);
			const f0 = r.frames[0];
			expect(damages(f0).map(d => d.depthBias)).toEqual([0, 1]);
			damages(f0).forEach(d => expect(d.depth.test).toBe(false));
			// fixed: legacy left SpriteRenderer.depth at the last index (R-DMG-009)
			sprites(r.frames[1]).forEach(sp => expect(sp.depthBias).toBe(0));
		}
	);
});
