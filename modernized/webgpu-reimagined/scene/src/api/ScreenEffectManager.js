/**
 * Legacy `ScreenEffectManager` facade (screenEffects: setNight, parseStatus, cleanStatusEffect, clean).
 * @param {{ screenEffects: import('../domain/ScreenEffects.js').ScreenEffects, scheduler: { tick: number } }} deps
 */
export const createScreenEffectManagerFacade = ({ screenEffects, scheduler }) => ({
	setNight(on) {
		screenEffects.setNight(on, scheduler.tick);
	},
	parseStatus(efst, flag) {
		screenEffects.parseStatus(efst, flag);
	},
	cleanStatusEffect() {
		screenEffects.cleanStatusEffect();
	},
	clean() {
		screenEffects.clean();
	},
	get flipped() {
		return screenEffects.flipped;
	}
});
