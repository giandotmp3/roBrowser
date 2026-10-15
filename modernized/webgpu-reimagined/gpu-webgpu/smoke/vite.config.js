import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../..');
const legacy = path.join(repoRoot, 'src');

const SUBSYSTEMS = ['App', 'Audio', 'Controls', 'Core', 'DB', 'Engine', 'Loaders', 'Network', 'Plugins'];
const MORE = ['Preferences', 'Renderer', 'UI', 'Utils', 'Vendors'];

/**
 * Legacy modules replaced by browser-safe stand-ins (smoke/entities/stubs.js): the
 * seams the legacy entity path reads (client, camera, DB, session, map, network, UI).
 * Keys are paths under the repo `src/`; the same set the root Node suite mocks for
 * the entity record tests (tests/renderer/support/legacySceneMocks.js).
 */
export const LEGACY_STUBS = Object.freeze([
	'Core/Client.js',
	'Renderer/Camera.js',
	'Renderer/Renderer.js',
	'Renderer/MapRenderer.js',
	'Loaders/Model.js',
	'Renderer/Map/Ground.js',
	'Renderer/Map/Altitude.js',
	'Renderer/Map/Water.js',
	'Renderer/GR2/GR2ModelRenderer.js',
	'Renderer/Effects/StrEffect.js',
	'Engine/SessionStorage.js',
	'Engine/MapEngine/Friends.js',
	'Engine/MapEngine/Guild.js',
	'Engine/MapEngine/Group.js',
	'Preferences/Graphics.js',
	'Network/PacketVerManager.js',
	'Network/NetworkManager.js',
	'Network/PacketStructure.js',
	'Audio/SoundManager.js',
	'DB/DBManager.js',
	'Controls/KeyEventHandler.js',
	'Controls/MouseEventHandler.js',
	'Utils/PathFinding.js',
	'UI/CursorManager.js',
	'UI/Components/InputBox/InputBox.js',
	'UI/Components/ChatRoom/ChatRoom.js',
	'UI/Components/ContextMenu/ContextMenu.js',
	'UI/Components/PetInformations/PetInformations.js',
	'UI/Components/Trade/Trade.js',
	'UI/Components/NpcBox/NpcBox.js',
	'UI/Components/ChatBox/ChatBox.js',
	'UI/Components/Equipment/Equipment.js',
	'UI/Components/Captcha/CaptchaSelector.js',
	'UI/Components/PartyFriends/PartyFriends.js',
	'UI/Components/HomunInformations/HomunInformations.js',
	'UI/Components/MercenaryInformations/MercenaryInformations.js',
	'UI/Components/EntityRoom/EntityRoom.js'
]);

const STUB_PREFIX = '\0legacy-stub:';

/**
 * Stubbed seams a page drives for real: legacy module → the smoke path prefixes whose
 * importers get the real module (the effects and backend pages import the real StrEffect,
 * the world page the real ground, water and altitude, with the legacy GridSelector reading
 * the real Altitude; the gr2 page the real GR2ModelRenderer, whose `granny-ro-js/wasm` import
 * resolves to smoke/gr2/granny.js; every other importer, e.g. the entity path's attachments,
 * keeps the stub). Same as gpu-webgl2.
 */
const WORLD_PAGE = path.join(packageRoot, 'smoke', 'world');
const GR2_PAGE = path.join(packageRoot, 'smoke', 'gr2');
/** The gr2 page's parse seam for `granny-ro-js/wasm` (synthetic models, real poseAt). */
const GRANNY_SEAM = path.join(GR2_PAGE, 'granny.js');
const REAL_FOR = Object.freeze({
	'Renderer/Effects/StrEffect.js': [
		path.join(packageRoot, 'smoke', 'effects'),
		path.join(packageRoot, 'smoke', 'backend')
	],
	'Renderer/Map/Ground.js': [WORLD_PAGE],
	'Renderer/Map/Water.js': [WORLD_PAGE],
	'Renderer/Map/Altitude.js': [WORLD_PAGE, path.join(legacy, 'Renderer', 'Map', 'GridSelector.js')],
	'Renderer/GR2/GR2ModelRenderer.js': [GR2_PAGE]
});

/**
 * Serves the parity pages: gpu-webgpu sources by relative import (WGSL via ?raw),
 * the legacy renderer through the repo's module aliases (read-only, unmodified),
 * with the LEGACY_STUBS seams swapped for smoke/entities/stubs.js whatever the
 * import spelling (alias or relative). `Renderer/Camera.js` is one of them, so
 * SpriteRenderer's `./Camera.js` gets smoke/cameraStub.js on every page. The
 * effects and backend pages get the real `Renderer/Effects/StrEffect.js`, the world page
 * the real map renderers (`REAL_FOR`).
 */
export default {
	root: packageRoot,
	logLevel: 'warn',
	resolve: {
		alias: Object.fromEntries([...SUBSYSTEMS, ...MORE].map(name => [name, path.join(legacy, name)]))
	},
	plugins: [
		{
			name: 'legacy-seam-stubs',
			enforce: 'pre',
			async resolveId(source, importer) {
				if (source === 'granny-ro-js/wasm') {
					return GRANNY_SEAM;
				}
				if (!importer || importer.startsWith('\0') || !/\.js$/.test(source)) {
					return null;
				}
				const resolved = await this.resolve(source, importer, { skipSelf: true });
				if (!resolved) {
					return null;
				}
				const rel = path.relative(legacy, resolved.id.split('?')[0]).split(path.sep).join('/');
				if (REAL_FOR[rel]?.some(prefix => importer.split('?')[0].startsWith(prefix))) {
					return null;
				}
				return LEGACY_STUBS.includes(rel) ? `${STUB_PREFIX}${rel}` : null;
			},
			load(id) {
				if (!id.startsWith(STUB_PREFIX)) {
					return null;
				}
				const rel = id.slice(STUB_PREFIX.length);
				// Root-relative URL: the same module instance the pages import.
				return `import { stubs } from '/smoke/entities/stubs.js';\nexport default stubs[${JSON.stringify(rel)}];\n`;
			}
		}
	],
	optimizeDeps: { noDiscovery: true, include: [] },
	server: {
		host: '127.0.0.1',
		fs: { allow: [repoRoot] },
		hmr: false
	}
};
