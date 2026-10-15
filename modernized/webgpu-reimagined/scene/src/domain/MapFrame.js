import { notImplemented } from '../errors.js';

/**
 * Scene-side steps of the per-frame map render (R-CTX-010 is gpu-owned; scene supplies the
 * CPU steps it needs and the non-render steps it owns: map sounds (22) and asset-eviction tick (24)).
 */
export const SCENE_FRAME_STEPS = Object.freeze([
	'camera.update', // 2
	'ground.pick', // 5 (R-PICK-001/002)
	'entities.cull', // 10 (R-PERF-001, R-UI-003)
	'records.emit', // 11-21 handed to render-records with camera + cull set
	'map.sounds', // 22
	'entities.pick', // 23 (R-PICK-004..006)
	'assets.evictTick' // 24
]);

/**
 * @param {object} _ctx
 */
export const runSceneFrame = _ctx => notImplemented('runSceneFrame (map sounds + eviction tick wiring)', 'C-01');
