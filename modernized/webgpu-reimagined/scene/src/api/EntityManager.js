import { HoverTracker, pickEntity } from '../domain/Picking.js';
import { computeVisibleSet } from '../domain/Culling.js';
import { applyCullToOverlays } from '../domain/Overlays.js';
import { notImplemented } from '../errors.js';

/**
 * Legacy `EntityManager` facade (entities.add/remove/query/hover/focus) + per-frame cull set.
 * Sort order and draw records belong to render-records (R-SPR-030).
 *
 * @param {object} deps
 * @param {import('../ports.js').SessionPort} deps.session
 * @param {import('../ports.js').GraphicsSettingsPort} deps.settings
 */
export const createEntityManagerFacade = ({ session, settings }) => {
	/** @type {Map<number, import('../domain/EntityTypes.js').SceneEntity>} */
	const byGid = new Map();
	const hover = new HoverTracker();
	let focus = null;
	/** @type {Set<object>} */
	let visible = new Set();

	const facade = {
		add(entity) {
			byGid.set(entity.GID, entity);
			return entity;
		},
		remove(gid) {
			byGid.delete(typeof gid === 'object' ? gid.GID : gid);
		},
		get(gid) {
			return byGid.get(gid) ?? null;
		},
		getByCID(cid) {
			for (const e of byGid.values()) {
				if (e.CID === cid) {
					return e;
				}
			}
			return null;
		},
		forEach(fn) {
			for (const e of [...byGid.values()]) {
				if (fn(e) === false) {
					break;
				}
			}
		},
		getClosestEntity(..._args) {
			return notImplemented('EntityManager.getClosestEntity', 'C-01');
		},
		getLowestHpEntity(..._args) {
			return notImplemented('EntityManager.getLowestHpEntity', 'C-01');
		},
		getOverEntity() {
			return hover.over;
		},
		setOverEntity(entity) {
			hover.over = entity;
		},
		getFocusEntity() {
			return focus;
		},
		setFocusEntity(entity) {
			focus = entity;
		},
		free() {
			byGid.clear();
			hover.over = null;
			focus = null;
			visible = new Set();
		},

		/** R-PERF-001 + R-UI-003: decide the visible set once per frame, before any pass. */
		cull() {
			visible = computeVisibleSet(byGid.values(), session.Entity ?? null, settings);
			for (const e of byGid.values()) {
				applyCullToOverlays(e, !visible.has(e));
			}
			return visible;
		},
		isCulled(entity) {
			return !visible.has(entity);
		},

		/** R-PICK-004/005/006: per-frame hover pick. */
		pick(mouse, { shift = false, supportMode = false, onOut = () => {}, onOver = () => {} } = {}) {
			const target = pickEntity(byGid.values(), mouse, {
				supportMode,
				culled: (e) => settings.performanceMode && !visible.has(e)
			});
			hover.update(target, shift, { onOut, onOver });
			return target;
		}
	};
	return facade;
};
