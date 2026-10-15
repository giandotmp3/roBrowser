/**
 * Stand-in for legacy Renderer/Camera.js inside the parity page. SpriteRenderer
 * only reads `Camera.zoom` and `Camera.getLatitude()` in bind3DContext; the real
 * module pulls in the DB, controls and session layers, which the page does not need.
 */
const Camera = {
	zoom: 30,
	getLatitude: () => -50
};

export default Camera;
