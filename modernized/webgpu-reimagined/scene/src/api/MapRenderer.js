import { isSameMap, normalizeMapName, toRswFilename } from '../domain/MapName.js';
import { Altitude } from '../domain/Altitude.js';

/**
 * Legacy `MapRenderer` facade (scene.setMap / onLoad / free / state) + worker-channel filter (§3.2).
 *
 * @param {object} deps
 * @param {import('../ports.js').MapLoaderPort} deps.loader
 * @param {{ free: () => void }} deps.entities
 * @param {{ free: () => void }} deps.damage
 * @param {{ free: () => void }} deps.effects
 * @param {{ onMapReady?: (payloads: object) => void }} [deps.backend]
 */
export const createMapRendererFacade = ({ loader, entities, damage, effects, backend = {} }) => {
	const facade = {
		currentMap: '',
		loading: false,
		fog: { use: false, exist: false, near: 0, far: 0, color: [0, 0, 0] },
		light: null,
		/** @type {Altitude} */
		altitude: Altitude.empty(),
		_loadRequest: null,
		/** scene.onLoad hook — reassigned by MapEngine. */
		onLoad() {},

		/**
		 * scene.setMap (R-CTX-011).
		 * @param {string} mapName
		 * @returns {boolean} true when a full load was started, false on same-map teleport
		 */
		setMap(mapName) {
			const name = normalizeMapName(mapName);
			if (isSameMap(facade.currentMap, name)) {
				entities.free();
				damage.free();
				effects.free();
				facade.onLoad();
				return false;
			}
			facade.loading = true;
			facade.currentMap = name;
			facade.free();
			facade._loadRequest = loader.load(toRswFilename(name));
			return true;
		},

		/**
		 * Worker message entry. Events from a stale load request are dropped.
		 * @param {{ type: string, request: number, payload: any }} msg
		 */
		onWorkerMessage(msg) {
			if (msg.request !== facade._loadRequest) {
				return false;
			}
			switch (msg.type) {
				case 'MAP_ALTITUDE':
					facade.altitude = new Altitude(msg.payload);
					break;
				case 'MAP_WORLD':
					facade.light = msg.payload.light;
					break;
				case 'LOAD_MAP_COMPLETE':
					facade.loading = false;
					backend.onMapReady?.(msg.payload);
					facade.onLoad();
					break;
				default:
					break;
			}
			return true;
		},

		/** scene.free */
		free() {
			facade.altitude = Altitude.empty();
			facade.light = null;
		}
	};
	return facade;
};
