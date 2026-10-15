/**
 * Behaviour-contract rules owned by gpu-webgpu (REIMAGINED_ARCHITECTURE.md §2.1).
 * R-MAP-016/017 (CPU matrices) are owned by render-records and excluded here.
 */
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}-${String(from + i).padStart(3, '0')}`);

export const ASSIGNED_RULES = Object.freeze([
	'R-CTX-001',
	'R-CTX-002',
	...range('R-CTX', 5, 7),
	'R-CTX-009',
	'R-CTX-010',
	'R-CTX-012',
	...range('R-MAP', 1, 15),
	...range('R-MAP', 18, 22),
	'R-MAP-024',
	'R-SPR-005',
	'R-SPR-006',
	'R-SPR-014',
	'R-SPR-016',
	...range('R-EFX', 8, 10),
	'R-EFX-013',
	'R-EFX-014',
	'R-EFX-018',
	...range('R-PP', 1, 10),
	'R-PP-012',
	'R-GR2-001',
	'R-GR2-002',
	'R-GR2-006',
	'R-PERF-003',
	'R-PERF-004'
]);

/** [FLAG] rules in this service's scope that HITL #1 decided to FIX (spec §6). */
export const FIXED_FLAG_RULES = Object.freeze(['R-MAP-010', 'R-MAP-013', 'R-EFX-010', 'R-PP-006', 'R-PP-007', 'R-PP-009']);

/** Rules whose acceptance tests are expected-failure (`it.fails`) until implemented. */
export const PENDING_RULES = Object.freeze([]);
