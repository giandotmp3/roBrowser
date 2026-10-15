/**
 * Legacy static `Camera` facade (camera.control + camera.matrices) over the domain Camera.
 * @param {{ camera: import('../domain/Camera.js').Camera }} deps
 */
export const createCameraFacade = ({ camera }) => ({
	setTarget(entity) {
		camera.setTarget(entity);
	},
	init(opts) {
		camera.init(opts);
	},
	rotate(dx, dy, screen, { shift = false } = {}) {
		if (shift) {
			camera.dragPitch(dy, screen.height);
		} else {
			camera.dragYaw(dx, screen.width);
		}
	},
	setZoom(value) {
		camera.setZoom(value);
	},
	setQuake(...args) {
		camera.setQuake(...args);
	},
	update(tick) {
		camera.update(tick);
	},
	get zoomFinal() {
		return camera.zoomFinal;
	},
	get angleFinal() {
		return camera.angleFinal;
	},
	get modelView() {
		return camera.modelView;
	},
	get normalMat() {
		return camera.normalMat;
	},
	get direction() {
		return camera.direction;
	}
});
