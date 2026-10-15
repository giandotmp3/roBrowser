import { signboardAnchor } from '../domain/Overlays.js';

/**
 * Legacy `SignboardManager` facade (signboards.add). DOM element creation is delegated.
 * @param {{ getAltitude: () => import('../domain/Altitude.js').Altitude }} deps
 */
export const createSignboardManagerFacade = ({ getAltitude }) => {
	const boards = [];
	return {
		/** @param {number} x @param {number} y @param {{ icon?: string, description?: string }} db */
		add(x, y, db) {
			const iconOnly = !db.description;
			const board = { x, y, db, anchor: signboardAnchor(x, y, { iconOnly }, getAltitude()) };
			boards.push(board);
			return board;
		},
		list() {
			return [...boards];
		},
		free() {
			boards.length = 0;
		}
	};
};
