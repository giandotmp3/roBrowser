import { LIFE_BAR } from '../constants.js';
import { EntityKind } from './EntityTypes.js';

/**
 * Life bar layout (R-UI-002, FLAG fixed: AP and hunger rows no longer overlap).
 * Pure layout; DOM drawing happens in the overlay layer.
 *
 * @param {object} p
 * @param {import('./EntityTypes.js').EntityKind} p.kind
 * @param {number} p.hpRatio 0..1
 * @param {boolean} [p.hasSp]
 * @param {boolean} [p.hasHunger]
 * @param {boolean} [p.hasAp]
 * @param {boolean} [p.isFourthClass]
 */
export const lifeBarLayout = ({ kind, hpRatio, hasSp = false, hasHunger = false, hasAp = false, isFourthClass = false }) => {
	const rows = [{ bar: 'hp', y: 0, height: LIFE_BAR.HP_HEIGHT }];
	let y = LIFE_BAR.HP_HEIGHT;
	const push = (bar) => {
		rows.push({ bar, y, height: LIFE_BAR.EXTRA_BAR_HEIGHT });
		y += LIFE_BAR.EXTRA_BAR_HEIGHT;
	};
	if (hasSp) {
		push('sp');
	}
	if (hasAp && isFourthClass) {
		push('ap');
	}
	if (hasHunger) {
		push('hunger');
	}

	const mobOrPet = kind === EntityKind.MOB || kind === EntityKind.PET;
	let hpColor = kind === EntityKind.MOB ? LIFE_BAR.HP_MOB : kind === EntityKind.PET ? LIFE_BAR.HP_PET : LIFE_BAR.HP_OTHER;
	if (hpRatio < LIFE_BAR.LOW_THRESHOLD) {
		hpColor = mobOrPet ? LIFE_BAR.HP_LOW_MOB_PET : LIFE_BAR.HP_LOW_OTHER;
	}

	return {
		width: LIFE_BAR.WIDTH,
		height: y,
		rows,
		border: LIFE_BAR.BORDER,
		empty: LIFE_BAR.EMPTY,
		hpColor,
		spColor: LIFE_BAR.SP,
		apColor: LIFE_BAR.AP,
		zIndex: kind === EntityKind.PC ? LIFE_BAR.Z_PC : LIFE_BAR.Z_OTHER
	};
};
