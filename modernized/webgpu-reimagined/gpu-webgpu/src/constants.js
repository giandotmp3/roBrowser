/**
 * GPU-side visual constants (spec §5 appendix, "Visual constants").
 * Every value cites the rule that fixes it. Nothing here is a credential.
 */

/** Single render format and sample count (architecture §2.2, R-CTX-001 antialias parity). */
export const RENDER_FORMAT = 'rgba8unorm';
export const DEPTH_FORMAT = 'depth24plus';
export const MSAA_SAMPLES = 4;

/** R-CTX-002 */
export const CLEAR_DEPTH = 1.0;
export const DEFAULT_DEPTH_COMPARE = 'less-equal';

/** R-CTX-006 overlay */
export const CONTEXT_LOST_OVERLAY = Object.freeze({
	background: 'rgba(0,0,0,0.85)',
	zIndex: 10000,
	title: 'Graphics Context Lost'
});
/** R-CTX-006 cache purge */
export const PURGE_ON_LOSS_EXTENSIONS = Object.freeze(['.bmp', '.jpg', '.png', '.spr', '.pal', '.str']);

/** R-MAP-003 */
export const GROUND_ALPHA_CUTOFF = 0.1;
/** R-MAP-002 */
export const POSTERIZE_STEP = 16;
/** R-MAP-004 */
export const FOG_DB_SCALE = 240;
/** R-MAP-005 */
export const GROUND_ATLAS_CELL = 258;
/** R-MAP-006 */
export const LIGHTMAP_BLOCK = 8;
/** R-MAP-008/009 */
export const WATER_FRAMES = 32;
export const WATER_FRAME_MS = 1000 / 60;
/** R-MAP-010 */
export const WATER_OPACITY_DEFAULT = 0.8;
export const WATER_OPAQUE_TYPES = Object.freeze([4, 6]);

/** R-MAP-018 */
export const OCCLUDER_DEFAULTS = Object.freeze({ mode: 'off', opacity: 0.25, radius: 5.0 });
/** R-MAP-019 */
export const OCCLUDER_QUERY = Object.freeze({
	axisRadius: 0.7,
	beforeFocus: 0.5,
	fadeInMs: 150,
	fadeOutMs: 300,
	dtCapMs: 100
});

/** R-MAP-021 */
export const GRID_SELECTOR = Object.freeze({ texture: 'grid.tga', alpha: 0.6, tint: [50, 240, 160], lift: 0.1 });

/** R-MAP-022 */
export const CLOUDS = Object.freeze({
	count: 150,
	size: 500,
	spawnRadius: 35,
	z: -10,
	driftXY: 0.01,
	driftZ: 0.001,
	driftStepMs: 25,
	dtCapMs: 250,
	fadeInMs: 1000,
	lifeMs: 6000,
	fadeOutMs: 2000,
	textures: Object.freeze([
		'cloud1.tga',
		'cloud2.tga',
		'cloud3.tga',
		'cloud4.tga',
		'cloud5.tga',
		'cloud6.tga',
		'cloud7.tga'
	])
});

/** R-SPR-006 */
export const ZINDEX_BIAS = 0.01;

/** R-EFX-009 */
export const STR = Object.freeze({ pxRatio: 1 / 35, pivot: 320, baseLift: 0.5, clipZBias: 0.1 });

/** R-EFX-018 */
export const POISON_TINT = Object.freeze({ size: 4000, color: Object.freeze([0.5, 0, 0.5, 0.15]) });

/** R-PP-003 */
export const PERF_SCENE_SCALE = 0.75;
/** R-PP-004 */
export const BLOOM = Object.freeze({
	threshold: 0.88,
	/** Shaders/Bloom.js uBloomSoftKnee; Bloom.fs passes threshold · softKnee as the knee. */
	softKnee: 0.45,
	knee: 0.88 * 0.45,
	downsample: 0.25,
	downsamplePerf: 0.125,
	tapTexels: 4
});
/** R-PP-005 */
export const BLUR_MASK = Object.freeze({ inner: 0.14, outer: 0.64 });
/** R-PP-006 */
export const FXAA = Object.freeze({ span: 8, reduceMul: 1 / 32, reduceMin: 1 / 128 });
/** R-PP-010 */
export const BLIND = Object.freeze({ radius: 0.2, falloff: 0.5, zoomRef: 63 });

/** R-GR2-001 */
export const GR2_ROSTER = Object.freeze([
	'guildflag90_1',
	'empelium90_0',
	'kguardian',
	'aguardian',
	'sguardian',
	'treasurebox_2'
]);
export const GR2_FALLBACK_SPRITE = 'poring';
/** R-GR2-002 */
export const GR2_ALPHA_REF = 207 / 255;
/** R-GR2-006 */
export const GR2_EMBLEM = Object.freeze({ srcSize: 24, potSize: 32, keyHigh: 248, keyLow: 8 });

/** Residency size classes (architecture §2.2). */
export const POT_CLASSES = Object.freeze([32, 64, 128, 256, 512]);
export const PALETTE_WIDTH = 256;
/** NFR-05 */
export const IDLE_EVICT_MS = 30000;
