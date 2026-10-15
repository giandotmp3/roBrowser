/**
 * Stand-in for legacy Renderer/Camera.js in the parity pages (served for every
 * import of it, see vite.config.js). SpriteRenderer reads `zoom` and
 * `getLatitude()` in bind3DContext; the entity path also reads `direction`,
 * `action`, `modelView` and `projection`. The real module pulls in the DB,
 * controls and session layers, which the pages do not need.
 */
const Camera = {
	zoom: 30,
	direction: 0,
	action: {},
	modelView: new Float32Array(16),
	projection: new Float32Array(16),
	getLatitude: () => -50
};

export default Camera;
