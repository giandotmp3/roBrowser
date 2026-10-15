/**
 * Behaviour-contract rules assigned to gpu-webgl2 (architecture §2.1:
 * "Same GPU-side rules" as gpu-webgpu).
 */
export const ASSIGNED_RULES = Object.freeze([
	// CTX
	'R-CTX-001', 'R-CTX-002', 'R-CTX-005', 'R-CTX-006', 'R-CTX-007', 'R-CTX-009', 'R-CTX-010', 'R-CTX-012',
	// MAP
	'R-MAP-001', 'R-MAP-002', 'R-MAP-003', 'R-MAP-004', 'R-MAP-005', 'R-MAP-006', 'R-MAP-007', 'R-MAP-008',
	'R-MAP-009', 'R-MAP-010', 'R-MAP-011', 'R-MAP-012', 'R-MAP-013', 'R-MAP-014', 'R-MAP-015',
	'R-MAP-018', 'R-MAP-019', 'R-MAP-020', 'R-MAP-021', 'R-MAP-022', 'R-MAP-024',
	// SPR (shader side)
	'R-SPR-005', 'R-SPR-006', 'R-SPR-014', 'R-SPR-016',
	// EFX
	'R-EFX-008', 'R-EFX-009', 'R-EFX-010', 'R-EFX-013', 'R-EFX-014', 'R-EFX-018',
	// PP
	'R-PP-001', 'R-PP-002', 'R-PP-003', 'R-PP-004', 'R-PP-005', 'R-PP-006', 'R-PP-007', 'R-PP-008',
	'R-PP-009', 'R-PP-010', 'R-PP-012',
	// GR2
	'R-GR2-001', 'R-GR2-002', 'R-GR2-006',
	// PERF
	'R-PERF-003', 'R-PERF-004'
]);

/** Rules with at least one `it.fails` test awaiting implementation. */
export const PENDING_RULES = Object.freeze(['R-MAP-005', 'R-MAP-015']);
