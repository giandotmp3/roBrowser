/**
 * Behaviour-contract rules assigned to render-records by
 * REIMAGINED_ARCHITECTURE.md §2.1 / §2.2 (including the flagged-bug fixes that
 * live here so both backends agree).
 */
const range = (prefix, from, to) =>
	Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(3, '0')}`);

export const ASSIGNED_RULES = Object.freeze([
	...range('R-SPR', 1, 33),
	...range('R-EFX', 1, 7),
	'R-EFX-010',
	'R-EFX-011',
	'R-EFX-012',
	...range('R-EFX', 15, 17),
	...range('R-DMG', 1, 9),
	...range('R-GR2', 3, 5),
	'R-MAP-010',
	'R-MAP-016',
	'R-MAP-017'
]);

/** Flagged legacy bugs whose acceptance tests assert the FIXED behaviour. */
export const FIXED_FLAG_RULES = Object.freeze(['R-MAP-010', 'R-EFX-010', 'R-EFX-011', 'R-DMG-004', 'R-DMG-009']);
