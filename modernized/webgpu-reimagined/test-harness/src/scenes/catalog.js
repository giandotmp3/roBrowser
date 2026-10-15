/**
 * Scripted parity scenes for the record-diff oracle (architecture §2.2, §5 phases 1-2).
 *
 * Each scene runs on the reference (legacy + shim) and on the subject (render-records);
 * the ordered record streams must be equal except where a flagged rule was deliberately
 * fixed (`divergences`: rule ID → ignored field paths or record filter).
 */
import { scene } from './SceneScript.js';
import { flatMap, pc, mob, npc, warp, gr2Mob } from './fixtures.js';

const VIEW = { width: 640, height: 480, dpr: 1, quality: 100 };
const LOCAL = 110_000_001;

const base = (name, map = flatMap()) =>
	scene(name)
		.viewport(VIEW)
		.session({ playing: true, localGid: LOCAL })
		.map(map.name, map)
		.entity(pc({ gid: LOCAL, position: [20, 20, 0], full: true }))
		.camera('setTarget', LOCAL);

export const PARITY_SCENES = Object.freeze([
	{
		id: 'crowd-200',
		rules: ['R-SPR-007', 'R-SPR-030', 'R-SPR-013', 'R-SPR-011'],
		build: () => {
			const s = base('crowd-200');
			for (let i = 0; i < 200; i++) {
				const at = [5 + (i % 30), 5 + Math.floor(i / 30) * 4, 0];
				const kind = [pc, mob, npc][i % 3];
				s.entity(kind({ gid: 130_000_000 + i, position: at, direction: i % 8, full: i % 3 === 0 }));
			}
			return s.frames(10).build();
		},
		divergences: {}
	},
	{
		id: 'states-and-trails',
		rules: ['R-SPR-018', 'R-SPR-019', 'R-SPR-022', 'R-SPR-023', 'R-SPR-024', 'R-SPR-025'],
		build: () =>
			base('states-and-trails')
				.entity(mob({ gid: 130_100_001, states: { bodyState: 'freeze' } }))
				.entity(mob({ gid: 130_100_002, states: { virtue: 'berserk' } }))
				.entity(
					pc({
						gid: 130_100_003,
						states: { effectState: 'assumptio', virtue: 'quicken' },
						action: 'walk',
						walkTo: [30, 20]
					})
				)
				.frames(30)
				.build(),
		divergences: {}
	},
	{
		id: 'combat-damage',
		rules: ['R-DMG-001', 'R-DMG-002', 'R-DMG-005', 'R-DMG-006'],
		build: () =>
			base('combat-damage')
				.entity(mob({ gid: 130_200_001, position: [22, 20, 0] }))
				.damage({ amount: 1234, gid: 130_200_001, type: 'normal' })
				.damage({ amount: 99, gid: 130_200_001, type: 'crit' })
				.damage({ amount: 0, gid: 130_200_001, type: 'miss' })
				.frames(100)
				.build(),
		// R-DMG-004 (Miss visibility) and R-DMG-009 (depth leak) are fixed on purpose.
		divergences: {
			'R-DMG-004': { filter: r => !(r.kind === 'damage' && r.damageType === 'miss') },
			'R-DMG-009': { ignore: ['depthBias'] }
		}
	},
	{
		id: 'effects-mix',
		rules: ['R-EFX-002', 'R-EFX-006', 'R-EFX-008', 'R-EFX-014'],
		build: () =>
			base('effects-mix')
				.effect({ effectId: 200, ownerAID: LOCAL })
				.effect({ effectId: 'fixture-str', ownerAID: LOCAL })
				.effect({ effectId: 'fixture-dup-3', ownerAID: LOCAL })
				.frames(60)
				.build(),
		divergences: { 'R-EFX-010': { ignore: ['fog'] } }
	},
	{
		id: 'world-and-gr2',
		rules: ['R-CTX-010', 'R-GR2-003', 'R-GR2-004', 'R-SPR-003'],
		build: () =>
			base(
				'world-and-gr2',
				flatMap({ water: { level: 1, type: 0, waveHeight: 5, waveSpeed: 2, wavePitch: 50, animSpeed: 3 } })
			)
				.entity(gr2Mob('empelium90_0', { gid: 130_300_001, position: [24, 20, 0] }))
				.entity(warp({ gid: 130_300_002, position: [18, 20, 0] }))
				.frames(20)
				.build(),
		divergences: {}
	}
]);

/** Merge divergence filters/ignores for a scene into diffRecords options. */
export function divergenceOptions(sceneDef) {
	const entries = Object.values(sceneDef.divergences ?? {});
	const filters = entries.map(d => d.filter).filter(Boolean);
	return {
		ignore: entries.flatMap(d => d.ignore ?? []),
		filter: filters.length ? r => filters.every(f => f(r)) : undefined
	};
}
