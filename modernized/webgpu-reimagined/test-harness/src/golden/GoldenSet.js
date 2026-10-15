/**
 * Smoke golden set (~12 scenes, architecture §2.2 / §5 phases 3-5).
 *
 * Rendered on ONE pinned software adapter (Chromium WebGPU on SwiftShader) for both
 * backends. Bloom goldens are WebGPU-only: legacy disables bloom on SwiftShader
 * (Utils/WebGL.js:240-246, R-PP-004), so there is no WebGL2 reference for them.
 *
 * Goldens are stored per backend: goldens/<backend>/<id>.png
 */

export const Backend = Object.freeze({ WEBGPU: 'webgpu', WEBGL2: 'webgl2' });

const BOTH = Object.freeze([Backend.WEBGPU, Backend.WEBGL2]);
const DEFAULT_TOL = Object.freeze({ threshold: 0.1, maxMismatchRatio: 0.005 });

/** @type {ReadonlyArray<{ id: string, title: string, backends: readonly string[], rules: string[], tolerance: object, seed: number, settle: number }>} */
export const GOLDENS = Object.freeze(
	[
		{
			id: 'ground-lightmap-fog',
			title: 'Ground, lightmap, tile colour, fog',
			rules: ['R-MAP-001', 'R-MAP-002', 'R-MAP-004', 'R-CTX-009']
		},
		{
			id: 'water',
			title: 'Water wave, frame and opacity (fixed alpha)',
			rules: ['R-MAP-008', 'R-MAP-009', 'R-MAP-010', 'R-MAP-011']
		},
		{
			id: 'models-static-animated',
			title: 'Static batch + animated RSM',
			rules: ['R-MAP-012', 'R-MAP-013', 'R-MAP-016', 'R-PERF-004']
		},
		{ id: 'occluder-dither', title: 'Occluder fade, dither mode', rules: ['R-MAP-018', 'R-MAP-019', 'R-MAP-020'] },
		{
			id: 'pc-layers',
			title: 'PC with full equipment, cart, shadow, front and back',
			rules: ['R-SPR-005', 'R-SPR-006', 'R-SPR-007', 'R-SPR-009', 'R-SPR-011', 'R-SPR-014']
		},
		{
			id: 'entity-states',
			title: 'State tints, additive body, halo, trails',
			rules: ['R-SPR-019', 'R-SPR-022', 'R-SPR-023', 'R-SPR-024', 'R-SPR-025']
		},
		{
			id: 'str-effects',
			title: 'STR blend census and fog (fixed)',
			rules: ['R-EFX-007', 'R-EFX-008', 'R-EFX-009', 'R-EFX-010']
		},
		{
			id: 'auras-weather',
			title: 'Additive families, level-99 aura, rain',
			rules: ['R-EFX-014', 'R-EFX-015', 'R-EFX-017']
		},
		{
			id: 'damage-numbers',
			title: 'Damage, heal, crit, miss (fixed), combo',
			rules: ['R-DMG-001', 'R-DMG-002', 'R-DMG-004', 'R-DMG-006']
		},
		{
			id: 'gr2-guildflag',
			title: 'GR2 guild flag with emblem and Emperium',
			rules: ['R-GR2-001', 'R-GR2-002', 'R-GR2-006']
		},
		{
			id: 'post-chain',
			title: 'FXAA + CAS + Cartoon + Vibrance + Blind',
			rules: ['R-PP-001', 'R-PP-006', 'R-PP-007', 'R-PP-008', 'R-PP-009', 'R-PP-010']
		},
		{ id: 'post-bloom', title: 'Bloom (WebGPU only)', rules: ['R-PP-004'], backends: [Backend.WEBGPU] }
	].map(g =>
		Object.freeze({
			backends: BOTH,
			tolerance: DEFAULT_TOL,
			seed: 0x5eed,
			settle: 1000,
			...g
		})
	)
);

/** All (golden, backend) pairs the smoke suite must render. */
export const goldenMatrix = () => GOLDENS.flatMap(g => g.backends.map(backend => ({ golden: g, backend })));

export const goldenPath = (backend, id) => `goldens/${backend}/${id}.png`;
