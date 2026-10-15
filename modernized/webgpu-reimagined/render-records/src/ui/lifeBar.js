/**
 * R-UI-002 life bar layout (record side of the fix; scene owns the DOM canvas).
 * FIX (diverges from legacy): AP and hunger no longer both draw at y = 9 —
 * each extra bar gets its own 4 px row, and AP is drawn only for 4th-class jobs
 * (legacy reserved its row only for 4th class but drew it regardless).
 */

export const LIFE_BAR = Object.freeze({
	width: 60,
	baseHeight: 5,
	rowHeight: 4,
	border: '#10189c',
	empty: '#424242',
	sp: '#1863de',
	ap: '#ffc663'
});

/**
 * @param {'mob'|'pet'|'other'} kind  mob includes ABR / bionic
 * @param {number} hpRatio
 */
export function hpColor(kind, hpRatio) {
	const low = hpRatio < 0.25;
	if (kind === 'mob') {
		return low ? '#FFFF00' : '#FF00E7';
	}
	if (kind === 'pet') {
		return low ? '#FFFF00' : '#FFE7E7';
	}
	return low ? '#FF0000' : '#10ef21';
}

/**
 * @param {Object} s
 * @param {'mob'|'pet'|'other'} s.kind
 * @param {number} s.hp
 * @param {number} s.hpMax
 * @param {number} [s.sp]
 * @param {number} [s.spMax]
 * @param {number} [s.ap]
 * @param {number} [s.apMax]
 * @param {boolean} [s.fourthClass]
 * @param {number} [s.hunger]
 * @param {number} [s.hungerMax]
 * @param {boolean} [s.isPc]
 * @returns {{width: number, height: number, zIndex: number, bars: Array<{name: string, y: number, fill: string, ratio: number}>}}
 */
export function lifeBarLayout({ kind, hp, hpMax, sp = -1, spMax = -1, ap = -1, apMax = -1, fourthClass = false, hunger = -1, hungerMax = -1, isPc = false }) {
	const bars = [{ name: 'hp', y: 1, fill: hpColor(kind, hp / hpMax), ratio: hp / hpMax }];
	const extra = [];
	if (sp > -1 && spMax > -1) {
		extra.push({ name: 'sp', fill: LIFE_BAR.sp, ratio: sp / spMax });
	}
	if (fourthClass && ap > -1 && apMax > -1) {
		extra.push({ name: 'ap', fill: LIFE_BAR.ap, ratio: ap / apMax });
	}
	if (hunger > -1 && hungerMax > -1) {
		const r = hunger / hungerMax;
		extra.push({ name: 'hunger', fill: r < 0.25 ? '#FFFF00' : '#FFE7E7', ratio: r });
	}
	extra.forEach((bar, i) => bars.push({ ...bar, y: 1 + LIFE_BAR.rowHeight * (i + 1) }));
	return {
		width: LIFE_BAR.width,
		height: LIFE_BAR.baseHeight + LIFE_BAR.rowHeight * extra.length,
		zIndex: isPc ? 2 : 1,
		bars
	};
}
