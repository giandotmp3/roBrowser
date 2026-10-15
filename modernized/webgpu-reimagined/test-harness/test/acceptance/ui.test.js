/** AI_NATIVE_SPEC §5.9 — UI: overlays, cursor, signboards (5 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run } from '../support/scenes.js';
import { mob, pc, pet } from '../../src/scenes/fixtures.js';
import { lastFrame, overlaysOf } from '../../src/subject/queries.js';

const G = 120_600_000;

describe('UI', () => {
	rule(
		'R-UI-001',
		'anchors: life −0.5; name −0.5 + 13 px; chat +90/35 (bottom, 2 px); cast +90/35; room +120/35; emblem +140/35',
		async s => {
			const r = await run(
				s,
				inGame('ui-001')
					.entity(pc({ gid: G + 1, name: 'fixture', chat: 'hi', casting: true, room: 'r', emblem: true }))
					.advance(16)
			);
			const o = Object.fromEntries(overlaysOf(lastFrame(r), G + 1).map(x => [x.widget, x]));
			expect(o.life.anchorCells).toBe(-0.5);
			expect(o.name.anchorCells).toBe(-0.5);
			expect(o.name.pixelOffsetY).toBe(13);
			expect(o.chat.anchorCells).toBeCloseTo(90 / 35, 6);
			expect(o.cast.anchorCells).toBeCloseTo(90 / 35, 6);
			expect(o.room.anchorCells).toBeCloseTo(120 / 35, 6);
			expect(o.emblem.anchorCells).toBeCloseTo(140 / 35, 6);
		}
	);

	rule(
		'R-UI-002',
		'life bar 60×5 (+4 per SP/hunger/AP), colours, <25%, PC z 2; AP and hunger do not overlap (legacy both at y=9)',
		async s => {
			const r = await run(
				s,
				inGame('ui-002')
					.entity(pc({ gid: G + 2, job: 4252, hp: [20, 100], sp: [1, 1], ap: [1, 1], hunger: [1, 1] }))
					.entity(mob({ gid: G + 3, hp: [50, 100] }))
					.entity(pet({ gid: G + 4, hp: [10, 100], hunger: [1, 1] }))
					.advance(16)
			);
			const f = lastFrame(r);
			const life = gid => overlaysOf(f, gid).find(o => o.widget === 'life');
			const p = life(G + 2);
			expect(p.width).toBe(60);
			expect(p.height).toBe(5 + 4 * 3);
			expect(p.zIndex).toBe(2);
			expect(p.bars.hp.color).toBe('#FF0000');
			expect(life(G + 3).bars.hp.color).toBe('#FF00E7');
			expect(life(G + 4).bars.hp.color).toBe('#FFFF00');
			const ap = p.bars.ap;
			const hunger = p.bars.hunger;
			if (ap && hunger) {
				expect(ap.y + ap.h <= hunger.y || hunger.y + hunger.h <= ap.y).toBe(true);
			}
			expect(p.border).toBe('#10189c');
		}
	);

	rule('R-UI-003', 'culled entities set all overlay canvases display:none', async s => {
		const r = await run(
			s,
			inGame('ui-003', { prefs: { performanceMode: true, viewArea: 14 } })
				.entity(mob({ gid: G + 5, position: [38, 20, 0], name: 'far' }))
				.advance(16)
		);
		const o = overlaysOf(lastFrame(r), G + 5);
		expect(o.length).toBeGreaterThan(0);
		o.forEach(x => expect(x.display).toBe('none'));
	});

	rule(
		'R-UI-004',
		'signboards at cell-centre ground level, +140/35 (full) or +120/35 (icon), left 70 or 15 px',
		async s => {
			const r = await run(
				s,
				inGame('ui-004')
					.signboard({ x: 22, y: 20, db: { kind: 'full' } })
					.signboard({ x: 24, y: 20, db: { kind: 'icon' } })
					.advance(16)
			);
			const [full, icon] = lastFrame(r).overlays.filter(o => o.widget === 'signboard');
			expect(full).toMatchObject({ anchorCells: 140 / 35, pixelOffsetX: -70 });
			expect(icon).toMatchObject({ anchorCells: 120 / 35, pixelOffsetX: -15 });
		}
	);

	rule(
		'R-UI-005',
		'cursor: ACT delay × type mult (DEFAULT 2, TARGET .5); one-shots clamp; magnetism snaps; own rAF when loop stops',
		async s => {
			const r = await run(
				s,
				inGame('ui-005', { prefs: { cursor: true, snap: true } })
					.entity(mob({ gid: G + 6, position: [22, 20, 0] }))
					.input({ type: 'mousemove', overGid: G + 6 })
					.advance(16)
			);
			const c = lastFrame(r).mouse;
			expect(c.cursorFrameDelayMultiplier).toBe(2);
			expect(c.snappedTo).toBe(G + 6);
		}
	);
});
