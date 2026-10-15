/**
 * Browser-safe stand-ins for the legacy seams of the entity render path, served by
 * smoke/vite.config.js in place of every LEGACY_STUBS module. Ported from the root
 * Node suite's tests/renderer/support/legacySceneMocks.js (same seams, same answers),
 * minus the jsdom canvas patch: the browser has a real 2D canvas.
 *
 * The page owns the state: it fills `files` (Client.loadFile answers from it) and
 * sets the camera matrices, session flags and clock tick.
 */
import Camera from '../cameraStub.js';

const nop = () => {};

/** Anything a module asks for that the scene does not exercise answers as a no-op. */
export const inert = (base = {}) =>
	new Proxy(base, {
		get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? nop : undefined)
	});

/** In-memory archive: path → compiled asset, as legacy Memory holds it after Client.loadFile. */
export const files = new Map();

export const client = {
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
};

/** Non-uniform ground (R-SPR-011 cell height, R-SPR-012 shadow factor), pure functions of the cell. */
export const terrain = {
	shadowFactor: (x, y) => 0.6 + (0.4 * ((Math.floor(x) * 3 + Math.floor(y)) % 5)) / 4,
	cellHeight: (x, y) => 0.1 * (Math.floor(x) % 7) - 0.05 * (Math.floor(y) % 5)
};

/** Obstacle-free 8-way path (diagonal first), as PathFinding.search returns it. */
const pathFinding = {
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
};

export const session = { AdminList: [], Playing: true, Entity: null };

export const graphics = { performanceMode: false, viewArea: 10, pixelPerfectSprites: false };

export const renderer = { tick: 0, width: 640, height: 480, getContext: () => null };

const isMob = job => job >= 1000 && job < 4000;
const isNpc = job => job >= 50 && job < 1000;

/** DB lookups: paths name the synthetic assets (smoke/entities/assets.js); other queries answer "no". */
export const db = inert({
	isPlayer: job => job >= 0 && job < 50,
	isBaby: () => false,
	isMonster: job => isMob(job),
	isSuperNovice: () => false,
	isDoram: () => false,
	getBodyPath: job => {
		if (isMob(job)) {
			return (
				{ 1002: 'data/sprite/mob', 1004: 'data/sprite/mob2', 1039: 'data/sprite/boss' }[job] ??
				'data/sprite/mob'
			);
		}
		if (isNpc(job)) {
			return 'data/sprite/npc';
		}
		return job % 2 ? 'data/sprite/body' : 'data/sprite/body2';
	},
	getHeadPath: () => 'data/sprite/head',
	getWeaponPath: () => 'data/sprite/weapon',
	getShieldPath: () => 'data/sprite/shield',
	getHatPath: id => `data/sprite/hat${id}`,
	getRobePath: () => 'data/sprite/robe',
	getCartPath: num => `data/sprite/cart${num}`,
	getWeaponTrail: () => null,
	getWeaponSound: () => null,
	getBodyPalPath: (_job, pal) => (pal > 0 ? `data/palette/body_${pal}.pal` : null),
	getHeadPalPath: (_head, pal) => (pal > 0 ? `data/palette/head_${pal}.pal` : null),
	hasMountPalettes: () => false,
	getWeaponAction: () => 0,
	getAttackSlice: () => null
});

/** Every LEGACY_STUBS module (vite.config.js) → its default export. */
export const stubs = {
	'Core/Client.js': client,
	'Renderer/Camera.js': Camera,
	'Renderer/Renderer.js': renderer,
	'Renderer/Map/Ground.js': { getShadowFactor: (x, y) => terrain.shadowFactor(x, y) },
	'Renderer/Map/Altitude.js': inert({
		TYPE: { NONE: 0, WALKABLE: 1, WATER: 2, SNIPABLE: 4 },
		getCellHeight: (x, y) => terrain.cellHeight(x, y),
		getCellType: () => 1
	}),
	'Renderer/Map/Water.js': {},
	'Renderer/GR2/GR2ModelRenderer.js': {
		attach: () => null,
		detach: nop,
		isMissing: () => false,
		isSupported: () => false
	},
	'Renderer/Effects/StrEffect.js': function StrEffect() {},
	'Engine/SessionStorage.js': session,
	'Engine/MapEngine/Friends.js': inert(),
	'Engine/MapEngine/Guild.js': inert(),
	'Engine/MapEngine/Group.js': inert(),
	'Preferences/Graphics.js': graphics,
	'Network/PacketVerManager.js': { value: 20221005, addSupport: nop },
	'Network/NetworkManager.js': inert(),
	'Network/PacketStructure.js': {},
	'Audio/SoundManager.js': inert(),
	'DB/DBManager.js': db,
	'Controls/KeyEventHandler.js': {},
	'Controls/MouseEventHandler.js': { screen: { x: 0, y: 0 }, world: { x: 0, y: 0, z: 0 } },
	'Utils/PathFinding.js': inert(pathFinding),
	'UI/CursorManager.js': inert(),
	'UI/Components/InputBox/InputBox.js': inert(),
	'UI/Components/ChatRoom/ChatRoom.js': inert(),
	'UI/Components/ContextMenu/ContextMenu.js': inert(),
	'UI/Components/PetInformations/PetInformations.js': inert(),
	'UI/Components/Trade/Trade.js': inert(),
	'UI/Components/NpcBox/NpcBox.js': inert(),
	'UI/Components/ChatBox/ChatBox.js': inert(),
	'UI/Components/Equipment/Equipment.js': inert(),
	'UI/Components/Captcha/CaptchaSelector.js': inert(),
	'UI/Components/PartyFriends/PartyFriends.js': inert(),
	'UI/Components/HomunInformations/HomunInformations.js': inert(),
	'UI/Components/MercenaryInformations/MercenaryInformations.js': inert(),
	'UI/Components/EntityRoom/EntityRoom.js': {
		clone: () => ({ ui: [{ style: {} }], append: nop, remove: nop })
	}
};
