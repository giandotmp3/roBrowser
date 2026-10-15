/**
 * R-CTX-010: the 25 map render steps in order. `owner` says who runs the step:
 * 'gpu' steps are passes of this backend; 'scene' steps are delegated to the
 * scene module through ScenePort.runStep (camera, picking, culling, sounds,
 * memory clean), keeping the frame one ordered function (no frame graph).
 */
export const MAP_FRAME_STEPS = Object.freeze([
	{ id: 1, name: 'postPrepare', owner: 'gpu' },
	{ id: 2, name: 'cameraUpdate', owner: 'scene' },
	{ id: 3, name: 'ground', owner: 'gpu' },
	{ id: 4, name: 'mapEffectEmitters', owner: 'gpu' },
	{ id: 5, name: 'groundPickAndGridSelector', owner: 'gpu' },
	{ id: 6, name: 'skyClouds', owner: 'gpu' },
	{ id: 7, name: 'occluderFadeBegin', owner: 'gpu' },
	{ id: 8, name: 'staticModels', owner: 'gpu' },
	{ id: 9, name: 'animatedModels', owner: 'gpu' },
	{ id: 10, name: 'entityCull', owner: 'scene' },
	{ id: 11, name: 'gr2Models', owner: 'gpu' },
	{ id: 12, name: 'screenEffectsBeforeEntities', owner: 'gpu' },
	{ id: 13, name: 'effectsBeforeEntities', owner: 'gpu' },
	{ id: 14, name: 'entities', owner: 'gpu' },
	{ id: 15, name: 'water', owner: 'gpu' },
	{ id: 16, name: 'fadedModels', owner: 'gpu' },
	{ id: 17, name: 'effectsAfterEntities', owner: 'gpu' },
	{ id: 18, name: 'effectEntities', owner: 'gpu' },
	{ id: 19, name: 'damageNumbers', owner: 'gpu' },
	{ id: 20, name: 'signboards', owner: 'gpu' },
	{ id: 21, name: 'screenEffects', owner: 'gpu' },
	{ id: 22, name: 'sounds', owner: 'scene' },
	{ id: 23, name: 'entityPick', owner: 'scene' },
	{ id: 24, name: 'memoryClean', owner: 'scene' },
	{ id: 25, name: 'postProcess', owner: 'gpu' }
]);

/**
 * Run one map frame in R-CTX-010 order.
 * @param {Record<string, () => void>} gpuPasses  keyed by step name
 * @param {import('../ports.js').ScenePort} scene
 * @returns {string[]} executed step names, in order
 */
export function runMapFrame(gpuPasses, scene) {
	const executed = [];
	for (const step of MAP_FRAME_STEPS) {
		if (step.owner === 'scene') {
			scene.runStep(step.name);
		} else {
			gpuPasses[step.name]?.();
		}
		executed.push(step.name);
	}
	return executed;
}
