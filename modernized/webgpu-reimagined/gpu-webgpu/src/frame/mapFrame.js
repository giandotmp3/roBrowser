/**
 * R-CTX-010: one ordered frame function (no frame-graph framework, architecture m1).
 * `owner` says which module performs the step: GPU steps are encoded here;
 * scene steps are delegated through ScenePort.runStep (camera, culling,
 * picking, sounds, eviction tick).
 */
export const MAP_FRAME_STEPS = Object.freeze([
	{ step: 'postPrepare', owner: 'gpu' }, // 1 clears colour + depth (scene pass begin)
	{ step: 'cameraUpdate', owner: 'scene' }, // 2
	{ step: 'ground', owner: 'gpu' }, // 3
	{ step: 'mapEffectEmitters', owner: 'gpu' }, // 4
	{ step: 'groundPickAndGrid', owner: 'gpu' }, // 5 ray-pick in scene, grid selector draw here
	{ step: 'skyClouds', owner: 'gpu' }, // 6
	{ step: 'occluderFadeBegin', owner: 'gpu' }, // 7
	{ step: 'staticModels', owner: 'gpu' }, // 8
	{ step: 'animatedModels', owner: 'gpu' }, // 9
	{ step: 'entityCull', owner: 'scene' }, // 10
	{ step: 'gr2Models', owner: 'gpu' }, // 11
	{ step: 'screenEffectsBeforeEntities', owner: 'gpu' }, // 12
	{ step: 'effectsBeforeEntities', owner: 'gpu' }, // 13
	{ step: 'entitiesNonEffect', owner: 'gpu' }, // 14
	{ step: 'water', owner: 'gpu' }, // 15
	{ step: 'fadedModels', owner: 'gpu' }, // 16 static, then animated
	{ step: 'effectsAfterEntities', owner: 'gpu' }, // 17
	{ step: 'effectEntities', owner: 'gpu' }, // 18
	{ step: 'damageNumbers', owner: 'gpu' }, // 19
	{ step: 'signboards', owner: 'scene' }, // 20 DOM
	{ step: 'screenEffects', owner: 'gpu' }, // 21
	{ step: 'sounds', owner: 'scene' }, // 22
	{ step: 'entityPick', owner: 'scene' }, // 23
	{ step: 'memoryClean', owner: 'scene' }, // 24
	{ step: 'postProcess', owner: 'gpu' } // 25
]);

/**
 * Run one in-game frame in legacy order.
 * @param {Record<string, () => void>} gpuSteps  encoders keyed by step name
 * @param {import('../ports.js').ScenePort} scene
 * @returns {string[]} executed step names (diagnostic)
 */
export function runMapFrame(gpuSteps, scene) {
	const executed = [];
	for (const { step, owner } of MAP_FRAME_STEPS) {
		if (owner === 'scene') {
			scene.runStep(step);
		} else {
			gpuSteps[step]?.();
		}
		executed.push(step);
	}
	return executed;
}
