/**
 * Shared Node seams for the legacy PC entity scene (LegacyRecordReplay / RecordDiff.entity).
 *
 * Imported from a test file's `vi.hoisted` block, before any legacy module loads, so it must not
 * import anything that the tests mock. The test file still declares its own `vi.mock` calls
 * (they are hoisted per file) and points them at these objects.
 */

// In-memory archive: path -> compiled asset. Rebuilt per scene run (see buildAssets).
const files = new Map();
const nop = () => {};

/** Anything a module asks for that the scene does not exercise answers as a no-op. */
const inert = (base = {}) =>
	new Proxy(base, {
		get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? nop : undefined)
	});

// jsdom has no 2D canvas; overlay mixins (EntityDisplay, EntityLife, ...) draw text into one
// at import / construction time. They are DOM widgets, not part of the sprite stream.
const ctx2d = canvas =>
	inert({
		canvas,
		measureText: () => ({ width: 100 }),
		getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
	});
const originalGetContext = globalThis.HTMLCanvasElement.prototype.getContext;
globalThis.HTMLCanvasElement.prototype.getContext = function getContext() {
	this._ctx ??= ctx2d(this);
	return this._ctx;
};

export const mocks = {
	files,
	inert,
	originalGetContext,
	restoreCanvas() {
		globalThis.HTMLCanvasElement.prototype.getContext = originalGetContext;
	},
	client: {
		// Legacy Client.loadFile answers synchronously from Memory once a file is cached.
		loadFile: (path, onLoad, onError) => {
			const data = files.get(path);
			if (data) {
				if (onLoad) {
					onLoad(data);
				}
				return data;
			}
			if (onError) {
				onError();
			}
			return undefined;
		}
	},
	camera: { direction: 0, zoom: 1, getLatitude: () => -45 },
	/**
	 * Non-uniform ground for scenes that opt in (RecordDiff.entityScenes): per-cell ground shadow
	 * (R-SPR-012) and cell height (R-SPR-011, walk z). Pure functions of the position, so the
	 * composer is handed the very same seams legacy reads.
	 */
	terrain: {
		shadowFactor: (x, y) => 0.6 + (0.4 * ((Math.floor(x) * 3 + Math.floor(y)) % 5)) / 4,
		cellHeight: (x, y) => 0.1 * Math.floor(x) - 0.05 * Math.floor(y)
	},
	/**
	 * Minimal Utils/PathFinding for walk scenes: an obstacle-free 8-way path (diagonal first, then
	 * straight), written as [x0, y0, x1, y1, ...] including the start cell, returning the node count
	 * as PathFinding.search does (Utils/PathFinding.js:298-311).
	 */
	pathFinding: {
		MAX_WALKPATH: 32,
		search(x0, y0, x1, y1, _range, out) {
			let x = x0;
			let y = y0;
			let n = 0;
			out[n++] = x;
			out[n++] = y;
			while (x !== x1 || y !== y1) {
				x += Math.sign(x1 - x);
				y += Math.sign(y1 - y);
				out[n++] = x;
				out[n++] = y;
			}
			return n / 2;
		}
	},
	session: { AdminList: [], Playing: false, Entity: null },
	graphics: { performanceMode: false, viewArea: 10, pixelPerfectSprites: false },
	// DB lookups: paths name the synthetic assets; every other query answers "no".
	db: inert({
		isPlayer: job => job >= 0 && job < 4000,
		isBaby: () => false,
		isMonster: () => false,
		isSuperNovice: () => false,
		isDoram: () => false,
		// Mobs (1000-3999) and NPCs (50-999) get their own synthetic bodies; players share one.
		getBodyPath: job => {
			if (job >= 1000 && job < 4000) {
				return 'data/sprite/mob';
			}
			return job >= 50 && job < 1000 ? 'data/sprite/npc' : 'data/sprite/body';
		},
		getHeadPath: () => 'data/sprite/head',
		getWeaponPath: () => 'data/sprite/weapon',
		getShieldPath: () => 'data/sprite/shield',
		getHatPath: id => `data/sprite/hat${id}`,
		// Robe 1 is short; robes 2 and 3 are tall enough to trip R-SPR-009 (riding / sitting variants).
		getRobePath: id => (id === 2 || id === 3 ? `data/sprite/robe${id}` : 'data/sprite/robe'),
		getCartPath: num => `data/sprite/cart${num}`,
		getWeaponTrail: () => null,
		getWeaponSound: () => null,
		getBodyPalPath: () => null,
		getHeadPalPath: () => null,
		hasMountPalettes: () => false,
		getWeaponAction: () => 0,
		getAttackSlice: () => null
	})
};
