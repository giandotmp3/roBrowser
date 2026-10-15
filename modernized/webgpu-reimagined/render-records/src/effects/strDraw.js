import { blendFromStr } from '../records/blend.js';

/**
 * Build the record fields for one STR layer draw.
 * R-EFX-008: unified blend from D3D codes, depth write off.
 * R-EFX-010 FIX (diverges from legacy, which never enabled STR fog): STR
 * layers obey the scene fog like every other fogged shader.
 * @param {{srcalpha: number, destalpha: number, color: number[]}} frame  interpolateStrLayer output
 * @param {{position: [number, number, number], attachment?: boolean, sceneFog: {use: boolean}}} s
 * @returns {Partial<import('../records/EffectDraw.js').EffectDraw>}
 */
export function strLayerDrawFields(frame, { position, attachment = false, sceneFog }) {
	return {
		family: 'str',
		position,
		color: /** @type {[number, number, number, number]} */ (frame.color.slice(0, 4)),
		blend: blendFromStr(frame.srcalpha, frame.destalpha),
		depthTest: true,
		depthWrite: false,
		fog: Boolean(sceneFog && sceneFog.use),
		strAttachment: attachment,
		params: { yLower: attachment ? 0 : 0.5, pivot: [320, 320], clipZBias: -0.1 }
	};
}
