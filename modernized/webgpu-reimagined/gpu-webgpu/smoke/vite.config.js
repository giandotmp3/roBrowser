import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../..');
const legacy = path.join(repoRoot, 'src');

const SUBSYSTEMS = ['App', 'Audio', 'Controls', 'Core', 'DB', 'Engine', 'Loaders', 'Network', 'Plugins'];
const MORE = ['Preferences', 'Renderer', 'UI', 'Utils', 'Vendors'];

/**
 * Serves the parity page: gpu-webgpu sources by relative import (WGSL via ?raw), the legacy
 * renderer through the repo's module aliases (read-only, unmodified).
 */
export default {
	root: packageRoot,
	logLevel: 'warn',
	resolve: {
		alias: Object.fromEntries([...SUBSYSTEMS, ...MORE].map(name => [name, path.join(legacy, name)]))
	},
	plugins: [
		{
			// Legacy SpriteRenderer imports './Camera.js' for zoom/latitude only.
			name: 'legacy-camera-stub',
			enforce: 'pre',
			resolveId(source, importer) {
				if (
					importer &&
					/[\\/]Renderer[\\/]SpriteRenderer\.js$/.test(importer) &&
					/Camera(\.js)?$/.test(source)
				) {
					return path.join(here, 'cameraStub.js');
				}
				return null;
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
