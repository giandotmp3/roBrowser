import { PICK } from '../constants.js';
import { EntityKind } from './EntityTypes.js';
import { notImplemented } from '../errors.js';

/**
 * CPU picking (C-12, R-PICK-002…007). No GPU readback.
 */

const NORMAL_PRIORITY = Object.freeze({
	[EntityKind.MOB]: 3,
	[EntityKind.ABR]: 3,
	[EntityKind.BIONIC]: 3,
	[EntityKind.ITEM]: 2,
	[EntityKind.NPC]: 1,
	[EntityKind.EFFECT]: -1,
	[EntityKind.FALCON]: -1,
	[EntityKind.WUG]: -1
});

const SUPPORT_PRIORITY = Object.freeze({
	[EntityKind.PC]: 3,
	[EntityKind.HOM]: 3,
	[EntityKind.MERC]: 3,
	[EntityKind.ELEM]: 3,
	[EntityKind.MOB]: 2,
	[EntityKind.PET]: 1
});

/**
 * R-PICK-004 priority table.
 * @param {import('./EntityTypes.js').EntityKind} kind
 * @param {boolean} supportMode
 */
export const pickPriority = (kind, supportMode = false) =>
	(supportMode ? SUPPORT_PRIORITY[kind] : NORMAL_PRIORITY[kind]) ?? 0;

/**
 * R-PICK-005 exclusions.
 * @param {import('./EntityTypes.js').SceneEntity} e
 * @param {{ culled?: (e: object) => boolean }} [ctx]
 */
export const isPickable = (e, { culled = () => false } = {}) => {
	if (e.removing) {
		return false;
	}
	if (e.dead && e.kind !== EntityKind.PC) {
		return false;
	}
	return !culled(e);
};

/**
 * R-PICK-004/005: sort by depth − priority·100 ascending; first rect containing the mouse wins.
 * @param {Iterable<import('./EntityTypes.js').SceneEntity>} entities
 * @param {{x:number,y:number}} mouse screen px
 * @param {{ supportMode?: boolean, culled?: (e: object) => boolean }} [opts]
 */
export const pickEntity = (entities, mouse, { supportMode = false, culled } = {}) => {
	const candidates = [...entities]
		.filter((e) => isPickable(e, { culled }) && e.pickRect)
		.map((e) => ({ e, key: (e.depth ?? 0) - pickPriority(e.kind, supportMode) * 100 }))
		.sort((a, b) => a.key - b.key);
	for (const { e } of candidates) {
		const r = e.pickRect;
		if (mouse.x >= r.x0 && mouse.x <= r.x1 && mouse.y >= r.y0 && mouse.y <= r.y1) {
			return e;
		}
	}
	return null;
};

/**
 * R-PICK-003: entity screen hit rectangle from body-layer extents.
 * @param {object} _args
 */
export const computePickRect = (_args) => notImplemented('computePickRect', 'R-PICK-003');

/** R-PICK-007: GR2 base-sphere square pick area. */
export const computeGr2PickRect = (_args) => notImplemented('computeGr2PickRect', 'R-PICK-007');

/**
 * R-PICK-002: per-frame mouse world state + walk cursor.
 * @param {object} p
 * @param {{ world: {x:number,y:number,z:number} }} p.mouse
 * @param {[number, number]|null} p.hit
 * @param {import('./Altitude.js').Altitude} p.altitude
 * @param {number} p.packetVer
 * @param {{ setType: (t: string) => void }} p.cursor
 * @param {(type: number) => boolean} p.isWalkable
 */
export const updateMouseWorld = ({ mouse, hit, altitude, packetVer, cursor, isWalkable }) => {
	mouse.world.x = -1;
	mouse.world.y = -1;
	mouse.world.z = -1;
	if (!hit) {
		return;
	}
	const x = Math.floor(hit[0]);
	const y = Math.floor(hit[1]);
	mouse.world.x = x;
	mouse.world.y = y;
	mouse.world.z = altitude.getCellHeight(x, y);
	if (packetVer >= PICK.WALK_CURSOR_PACKETVER) {
		cursor.setType(isWalkable(altitude.getCellType(x, y)) ? 'DEFAULT' : 'NOWALK');
	}
};

/**
 * R-PICK-006: hover tracking. Fires mouseOut/mouseOver when the target or Shift state changes.
 */
export class HoverTracker {
	constructor() {
		this.over = null;
		this.shift = false;
	}

	/**
	 * @param {object|null} target
	 * @param {boolean} shift
	 * @param {{ onOut: (e: object) => void, onOver: (e: object) => void }} handlers
	 */
	update(target, shift, { onOut, onOver }) {
		if (target === this.over && shift === this.shift) {
			return;
		}
		if (this.over) {
			onOut(this.over);
		}
		this.over = target;
		this.shift = shift;
		if (target) {
			onOver(target);
		}
	}
}
