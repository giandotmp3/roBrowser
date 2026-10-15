import { FOG_DB_SCALE, POISON_TINT, STR } from '../constants.js';
import { ADDITIVE } from '../pipelines/pipelineKey.js';
import { D3D_TO_GPU } from '../pipelines/blendMap.js';

/** R-EFX-014: effect families always drawn with SRC_ALPHA, ONE. */
export const ADDITIVE_FAMILIES = Object.freeze([
	'GroundAura',
	'SwirlingAura',
	'Level99Bubble',
	'SpiritSphere',
	'WarlockSphere',
	'PokJukWeatherEffect',
	'WaterfallEffect'
]);

/** @returns {{src: string, dst: string}|null} forced blend for a family, or null */
export function familyBlend(family) {
	return ADDITIVE_FAMILIES.includes(family) ? ADDITIVE : null;
}

/**
 * R-EFX-008: STR pipeline spec. Blend from the D3DBLEND pair; depth write off.
 * Unknown codes fall back to normal alpha.
 */
export function strPipelineSpec(srcCode, dstCode) {
	const src = D3D_TO_GPU[srcCode];
	const dst = D3D_TO_GPU[dstCode];
	return {
		family: 'str',
		gpuBlend:
			src && dst
				? { srcFactor: src, dstFactor: dst }
				: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
		depthTest: true,
		depthWrite: false
	};
}

/**
 * R-EFX-009 (reference of shaders/str.wgsl vertex stage): 1/35 world unit per
 * pixel, pivot pos − (320, 320), Y lowered 0.5 except for attachments, clip z −0.1.
 * @param {[number, number]} px  vertex position in STR pixels
 */
export function strVertex(px, { attachment = false } = {}) {
	return {
		x: (px[0] - STR.pivot) * STR.pxRatio,
		y: (px[1] - STR.pivot) * STR.pxRatio - (attachment ? 0 : STR.baseLift),
		clipZBias: -STR.clipZBias
	};
}

/** R-EFX-009 fragment: pure-black or zero-alpha texels are discarded. */
export function strDiscard(tex) {
	return tex[3] === 0 || (tex[0] === 0 && tex[1] === 0 && tex[2] === 0);
}

/**
 * R-EFX-010 FIX: STR effects obey the scene fog (legacy never set uFogUse and
 * uploaded near/far ×100/×150). Uses the same uniforms as every other shader.
 * @param {{use: boolean, near: number, far: number, color: number[]}} sceneFog  from world/fog.js fogUniforms
 */
export function strFogUniforms(sceneFog) {
	return { ...sceneFog, color: [...sceneFog.color] };
}
export const STR_LEGACY_FOG_SCALE = Object.freeze({ near: 100, far: 150, correct: FOG_DB_SCALE });

/**
 * R-EFX-013: overlay effects disable depth test and depth correction;
 * non-overlay effects test depth; 2D effects also write it.
 * @param {'2d'|'3d'|string} family
 */
export function effectDepthState(family, overlay) {
	if (overlay) {
		return { depthTest: false, depthWrite: false, depthCorrection: false };
	}
	return { depthTest: true, depthWrite: family === '2d', depthCorrection: true };
}

/** R-EFX-018: poison screen tint billboard at the player, no depth. */
export function poisonTintDraw(playerPosition) {
	return {
		family: 'PoisonEffect',
		position: [...playerPosition],
		size: [POISON_TINT.size, POISON_TINT.size],
		color: [...POISON_TINT.color],
		depthTest: false,
		depthWrite: false
	};
}
