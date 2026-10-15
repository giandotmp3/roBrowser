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
	session: { AdminList: [], Playing: false, Entity: null },
	graphics: { performanceMode: false, viewArea: 10, pixelPerfectSprites: false },
	// DB lookups: paths name the synthetic assets; every other query answers "no".
	db: inert({
		isPlayer: job => job >= 0 && job < 4000,
		isBaby: () => false,
		isMonster: () => false,
		isSuperNovice: () => false,
		isDoram: () => false,
		getBodyPath: () => 'data/sprite/body',
		getHeadPath: () => 'data/sprite/head',
		getWeaponPath: () => 'data/sprite/weapon',
		getShieldPath: () => 'data/sprite/shield',
		getHatPath: id => `data/sprite/hat${id}`,
		getRobePath: () => 'data/sprite/robe',
		getCartPath: () => 'data/sprite/cart',
		getWeaponTrail: () => null,
		getWeaponSound: () => null,
		getBodyPalPath: () => null,
		getHeadPalPath: () => null,
		hasMountPalettes: () => false,
		getWeaponAction: () => 0,
		getAttackSlice: () => null
	})
};
