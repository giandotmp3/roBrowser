/**
 * gpu-webgpu: WebGPU backend of the reimagined roBrowser renderer.
 * Consumes render-records (SpriteDraw / EffectDraw / WorldDraw) and MAP_*
 * worker payloads; contains no gameplay rendering rules (architecture §1).
 */
export * from './errors.js';
export * from './constants.js';
export { selectBackend, WebGpuBackend, backingStoreSize } from './WebGpuBackend.js';

export { RenderDevice, DEVICE_REQUEST, DEFAULT_PIPELINE_STATE, REQUIRED_LIMITS } from './device/RenderDevice.js';
export { onRenderError } from './device/frameErrorPolicy.js';
export { DeviceLossController } from './device/DeviceLossController.js';

export { OffscreenTarget, sceneSize } from './target/OffscreenTarget.js';
export { Blit } from './target/Blit.js';

export {
	toGpuFactor,
	toGpuBlend,
	blendConstantFor,
	resolveBlend,
	usesBlendConstant,
	isMixedConstantBlend,
	D3D_TO_GPU,
	LEGACY_BLEND_CONSTANT
} from './pipelines/blendMap.js';
export { pipelineSpecKey, NORMAL, ADDITIVE } from './pipelines/pipelineKey.js';
export { PipelineSet, describePipeline, expandCensus } from './pipelines/PipelineSet.js';

export { applyMagentaKey, potSize, sizeClass, mipLevelCount, samplerDescriptor } from './residency/imageKey.js';
export {
	prepareIndexedFrame,
	prepareRgbaFrame,
	centerRgbaPot,
	decodeSprFrame,
	spriteSampler
} from './residency/spriteFrames.js';
export { Residency, ArrayPool, PaletteTable } from './residency/Residency.js';
export { SpriteResidency, RESIDENT_EFFECT_FAMILIES } from './residency/SpriteResidency.js';
export {
	decodeImageTexture,
	decodeSelfDrawnTexture,
	decodeTileTexture,
	unpackViaGl
} from './residency/imageTexture.js';
export { TextureArrayPools, padLayer } from './residency/TextureArrayPools.js';

export { globalLight, skyForMap, mapLight, clearColorFor } from './world/lighting.js';
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
export {
	MapWorld,
	packWorldUniforms,
	WORLD_STEPS,
	WORLD_UNIFORM_BYTES,
	WORLD_UNIFORM_STRIDE,
	OCCLUDER_MODE,
	QUERY_SLOT
} from './world/MapWorld.js';
export { LayerSet } from './world/LayerSet.js';
export { AnimatedRsm, ANIMATED_VERTEX_FLOATS, computeRsmNormals } from './world/animatedRsm.js';
export {
	canvasTexels,
	composeGridTexture,
	composeGroundAtlas,
	createImageDecoder,
	potTexels,
	stretchToPot
} from './world/worldImages.js';

export { MAP_FRAME_STEPS, runMapFrame } from './frame/mapFrame.js';

export {
	SpriteRunRenderer,
	zIndexBias,
	depthCorrectedClipZ,
	projectSprite,
	spriteVertexClip,
	samplePaletteBilinear,
	SPRITE_INSTANCE_FLOATS,
	SPRITE_FAMILY,
	SPRITE_MIXED_SAMPLED_TEXTURES,
	canMixTextureClasses,
	spriteShaderSource,
	spriteSpec,
	spriteCensus,
	packFrameUniforms,
	spriteBindGroupLayoutEntries,
	spriteProgramClass,
	FRAME_UNIFORM_BYTES
} from './sprites/SpriteRunRenderer.js';
export {
	SPRITE_INSTANCE_FIELDS,
	SPRITE_INSTANCE_ATTRIBUTES,
	SPRITE_INSTANCE_STRIDE,
	SPRITE_VERTEX_BUFFERS,
	SPRITE_QUAD,
	SPRITE_SAMPLING,
	packSpriteInstance,
	unpackSpriteInstance
} from './sprites/instanceLayout.js';
export { fromLegacySpriteRecord } from './sprites/legacyRecord.js';
export { InstanceRing } from './sprites/InstanceRing.js';
export { splitRuns, splitBatches, recordRunKey, batchKey, effectProgram, programOf } from './sprites/runs.js';
export { RunRenderer } from './batching/RunRenderer.js';
export { encodeBatches } from './batching/encodeBatches.js';
export { StrPipeline, STR_FAMILY, strSpec, strBindGroupLayoutEntries } from './effects/StrPipeline.js';
export {
	packStrInstance,
	STR_INSTANCE_FIELDS,
	STR_INSTANCE_ATTRIBUTES,
	STR_INSTANCE_FLOATS,
	STR_INSTANCE_STRIDE,
	STR_VERTEX_BUFFERS
} from './effects/strInstance.js';
export { spriteEffectView, spriteEffectClass, isSpriteEffect, SPRITE_EFFECT_FAMILIES } from './effects/spriteEffect.js';
export { fromLegacyEffectRecord } from './effects/legacyRecord.js';
export {
	MeshEffectPipeline,
	MESH_FAMILY_PREFIX,
	MESH_FRAME_BYTES,
	MESH_WRAPS,
	meshBindGroupLayoutEntries,
	meshCensus,
	meshSpec,
	packMeshFrame
} from './effects/mesh/MeshEffectPipeline.js';
export {
	MESH_EFFECT_FAMILIES,
	MESH_EFFECT_PROGRAM,
	TEXTURED_MESH_FAMILIES,
	meshKey,
	meshProgramKey,
	meshWrap
} from './effects/mesh/meshFamilies.js';
export { MESH_PROGRAMS, meshFloats, meshShaderSource, meshVertexBuffers } from './effects/mesh/programs.js';
export * from './effects/effectState.js';
export { EffectRenderers } from './effects/EffectRenderers.js';
export * from './gr2/gr2.js';
export { Gr2Renderer, GR2_INSTANCE_BYTES, GR2_PALETTE_BYTES, packGr2Instance } from './gr2/Gr2Renderer.js';
export { Gr2Residency } from './gr2/Gr2Residency.js';
export * from './post/postChain.js';
export * from './post/postPasses.js';
export { PostChain } from './post/PostChainRenderer.js';
export { LivePreviews } from './preview/LivePreviews.js';
export { Capture, unpackRows, COPY_ROW_ALIGNMENT } from './capture/Capture.js';
