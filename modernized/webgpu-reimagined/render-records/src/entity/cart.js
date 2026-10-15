/** R-SPR-010 cart pixel offsets by visual direction 0..7. */
export const CART_OFFSETS = Object.freeze([
	[0, -30],
	[30, -10],
	[40, 0],
	[30, 10],
	[0, 20],
	[-30, 10],
	[-40, 0],
	[-30, -10]
]);

/**
 * @param {number} visualDir
 * @returns {readonly number[]}
 */
export function cartOffset(visualDir) {
	return CART_OFFSETS[((visualDir % 8) + 8) % 8];
}

/**
 * R-SPR-010 cart selection and visibility.
 * @param {{cartType: number, isSuperNovice: boolean, playing: boolean, idle: boolean, frame: number}} s
 */
export function cartState({ cartType, isSuperNovice, playing, idle, frame }) {
	return {
		visible: playing && cartType > 0,
		sprite: isSuperNovice ? 0 : cartType,
		frame: idle ? 0 : frame
	};
}
