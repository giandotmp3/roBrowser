/**
 * Legacy `Damage` facade (damage.add). Number logic (R-DMG-*) lives in render-records.
 * @param {{ damage: { add: (amount: number, entity: object, tick: number, weapon?: unknown, type?: number) => void, free: () => void } }} deps
 */
export const createDamageFacade = ({ damage }) => ({
	add(amount, entity, tick, weapon, type) {
		damage.add(amount, entity, tick, weapon, type);
	},
	free() {
		damage.free();
	}
});
