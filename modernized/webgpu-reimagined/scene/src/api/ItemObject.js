import { EntityKind } from '../domain/EntityTypes.js';

/**
 * Legacy `ItemObject` facade (items.add/remove). Items are scene entities of kind ITEM;
 * the fall animation (R-SPR-033) and sprite records belong to render-records.
 * @param {{ entities: { add: (e: object) => object, remove: (gid: number) => void } }} deps
 */
export const createItemObjectFacade = ({ entities }) => ({
	add(gid, itemid, identify, count, x, y, z, dropeffectmode = 0, showdropeffect = false) {
		return entities.add({
			GID: gid,
			kind: EntityKind.ITEM,
			itemid,
			identify,
			count,
			position: [x, y, z],
			dropeffectmode,
			showdropeffect
		});
	},
	remove(gid) {
		entities.remove(gid);
	}
});
