/**
 * gpu-webgpu: WebGPU backend of the reimagined roBrowser renderer.
 * Consumes render-records (SpriteDraw / EffectDraw / WorldDraw) and MAP_*
 * worker payloads; contains no gameplay rendering rules (architecture §1).
 */
export * from './errors.js';
export * from './constants.js';
export { selectBackend } from './WebGpuBackend.js';

export { RenderDevice, DEVICE_REQUEST, DEFAULT_PIPELINE_STATE, REQUIRED_LIMITS } from './device/RenderDevice.js';
export { onRenderError } from './device/frameErrorPolicy.js';
export { DeviceLossController } from './device/DeviceLossController.js';

export { OffscreenTarget, sceneSize } from './target/OffscreenTarget.js';

export { toGpuFactor, toGpuBlend, blendConstantFor, D3D_TO_GPU, LEGACY_BLEND_CONSTANT } from './pipelines/blendMap.js';
export { pipelineSpecKey, NORMAL, ADDITIVE } from './pipelines/pipelineKey.js';
export { PipelineSet, describePipeline, expandCensus } from './pipelines/PipelineSet.js';

export { applyMagentaKey, potSize, sizeClass, mipLevelCount, samplerDescriptor } from './residency/imageKey.js';
export { prepareIndexedFrame, prepareRgbaFrame } from './residency/spriteFrames.js';
export { Residency, ArrayPool, PaletteTable } from './residency/Residency.js';

export { globalLight, skyForMap } from './world/lighting.js';
export { fogUniforms, applyFog } from './world/fog.js';
export { shadeGround, lightmapRgb, groundAtlasLayout, lightmapAtlasLayout, tileColorsToRgba } from './world/ground.js';
export {
	waterParams,
	waveOffset,
	waveY,
	waterFrameIndex,
	waterOpacity,
	shadeWater,
	WATER_DEPTH
} from './world/water.js';
export {
	modelAlpha,
	shadeModel,
	MODEL_DEPTH,
	rsmInstanceMatrix,
	computeNormals,
	SHADE,
	batchStaticModels
} from './world/models.js';
export * from './world/occluderFade.js';
export { gridSelectorCells, gridSelectorQuad } from './world/gridSelector.js';
export { CLOUD_DEPTH, spawnCloud, createCloudField, cloudAlpha } from './world/sky.js';
export { MapGpuScene } from './world/MapGpuScene.js';

export { MAP_FRAME_STEPS, runMapFrame } from './frame/mapFrame.js';

export {
	SpriteRunRenderer,
	zIndexBias,
	depthCorrectedClipZ,
	samplePaletteBilinear,
	SPRITE_INSTANCE_FLOATS
} from './sprites/SpriteRunRenderer.js';
export * from './effects/effectState.js';
export { EffectRenderers } from './effects/EffectRenderers.js';
export * from './gr2/gr2.js';
export { Gr2Renderer } from './gr2/Gr2Renderer.js';
export * from './post/postChain.js';
export { LivePreviews } from './preview/LivePreviews.js';
export { Capture } from './capture/Capture.js';
