import { CAMERA, PROJECTION } from '../constants.js';
import { create, identity, invert, multiply, rotateX, rotateY, translate, toRad } from '../math/mat4.js';
import { notImplemented } from '../errors.js';

/** @typedef {'iso'|'third'|'first'} CameraMode */

const ALTITUDE_RANGE = Math.abs(CAMERA.ALTITUDE_TO - CAMERA.ALTITUDE_FROM); // 65

/**
 * Camera (C-02, R-CAM-001…011). Pure CPU; produces matrices consumed by records,
 * picking and overlays. Instance-scoped (no module-level singletons, spec §2.3).
 */
export class Camera {
	/**
	 * @param {object} [deps]
	 * @param {import('../ports.js').Rng} [deps.rng]
	 * @param {import('../ports.js').TimerPort} [deps.timers]
	 * @param {{ zoom?: number, indoorZoom?: number, smooth?: boolean, save?: () => void }} [deps.prefs]
	 * @param {{ maxZoomOut?: number, firstPerson?: boolean, thirdPerson?: boolean }} [deps.config]
	 */
	constructor({ rng = Math.random, timers = null, prefs = {}, config = {} } = {}) {
		this.rng = rng;
		this.timers = timers;
		this.prefs = prefs;
		this.config = config;
		/** @type {CameraMode} */
		this.mode = 'iso';
		this.indoor = false;
		this.zoomStepMult = 1;
		this.position = [0, 0, 0];
		/** @type {{ position: number[] }|null} */
		this.target = null;
		this.zoom = CAMERA.DEFAULT_ZOOM;
		this.zoomFinal = CAMERA.DEFAULT_ZOOM;
		/** [pitch, yaw] in degrees */
		this.angle = [CAMERA.DEFAULT_PITCH, CAMERA.DEFAULT_YAW];
		this.angleFinal = [CAMERA.DEFAULT_PITCH, CAMERA.DEFAULT_YAW];
		this.direction = 0;
		this.lastTick = 0;
		this.zOffset = 0;
		this.modelView = create();
		this.normalMat = create();
		this.focus = [0, 0, 0];
	}

	/** @param {{ position: number[] }} entity */
	setTarget(entity) {
		this.target = entity;
	}

	/**
	 * Map entry (R-CAM-002).
	 * @param {{ indoor: boolean }} p
	 */
	init({ indoor }) {
		this.indoor = indoor;
		this.angle[0] = this.angleFinal[0] = CAMERA.DEFAULT_PITCH;
		if (indoor) {
			this.angle[0] = this.angleFinal[0] = CAMERA.INDOOR_PITCH;
			this.angle[1] = this.angleFinal[1] = CAMERA.INDOOR_YAW;
			this.zoom = this.zoomFinal = this.prefs.indoorZoom ?? CAMERA.DEFAULT_ZOOM;
		} else {
			this.angle[1] = this.angleFinal[1] = CAMERA.DEFAULT_YAW;
			this.zoom = this.zoomFinal = this.prefs.zoom ?? CAMERA.DEFAULT_ZOOM;
		}
	}

	/** Zoom range for iso mode (R-CAM-001). */
	zoomRange() {
		const max = this.indoor ? CAMERA.INDOOR_MAX_ZOOM : (this.config.maxZoomOut ?? CAMERA.MAX_ZOOM);
		return [ALTITUDE_RANGE * CAMERA.MIN_ZOOM, ALTITUDE_RANGE * max];
	}

	/** @param {number} value */
	setZoom(value) {
		const [min, max] = this.zoomRange();
		this.zoomFinal = Math.min(max, Math.max(min, value));
	}

	/** Mouse wheel: positive steps zoom out (R-CAM-001). */
	wheel(steps) {
		this.setZoom(this.zoomFinal + steps * CAMERA.ZOOM_STEP * this.zoomStepMult);
	}

	/** Ctrl+right-drag zoom (R-CAM-001). */
	ctrlDragZoom(dy) {
		this.setZoom(this.zoomFinal + dy * ((CAMERA.ZOOM_STEP * this.zoomStepMult) / 10));
	}

	/** Active pitch clamp (R-CAM-003). */
	pitchRange() {
		if (this.mode === 'first') {
			return CAMERA.PITCH_FIRST;
		}
		if (this.mode === 'third') {
			return CAMERA.PITCH_THIRD;
		}
		return this.indoor ? CAMERA.PITCH_INDOOR : CAMERA.PITCH_ISO;
	}

	/** Shift+right-drag pitch (R-CAM-003). */
	dragPitch(dy, screenHeight) {
		const [min, max] = this.pitchRange();
		const next = this.angleFinal[0] + (dy / screenHeight) * CAMERA.PITCH_DRAG_DEG;
		this.angleFinal[0] = Math.min(max, Math.max(min, next));
	}

	/** Right-drag yaw (R-CAM-004). */
	dragYaw(dx, screenWidth) {
		const [min, max] = this.indoor ? CAMERA.YAW_INDOOR : CAMERA.YAW_OUTDOOR;
		const next = this.angleFinal[1] - (dx / screenWidth) * CAMERA.YAW_DRAG_DEG;
		this.angleFinal[1] = Math.min(max, Math.max(min, next));
		if (this.angleFinal[1] > 180) {
			this.angleFinal[1] -= 360;
			this.angle[1] -= 360;
		} else if (this.angleFinal[1] < -180) {
			this.angleFinal[1] += 360;
			this.angle[1] += 360;
		}
	}

	/**
	 * Plain right-drag: yaw, plus pitch in third/first person (R-CAM-003, R-CAM-004, R-CAM-009).
	 * @param {number} _dx
	 * @param {number} _dy
	 * @param {{ width: number, height: number }} _screen
	 */
	rightDrag(_dx, _dy, _screen) {
		notImplemented('Camera.rightDrag (mode-aware drag)', 'R-CAM-003', 'R-CAM-009');
	}

	/**
	 * Right-press for double-click reset detection (R-CAM-005).
	 * @param {{ x: number, y: number, tick: number, shift?: boolean, ctrl?: boolean }} _press
	 */
	rightPress(_press) {
		notImplemented('Camera.rightPress double-click reset', 'R-CAM-005');
	}

	/**
	 * Re-evaluate first/third/iso mode from zoomFinal + config (R-CAM-009).
	 * @returns {{ mode: CameraMode, vFov: number, zOffset: number }}
	 */
	resolveMode() {
		return notImplemented('Camera.resolveMode', 'R-CAM-009');
	}

	/** Current vertical FOV for the projection. Iso only until R-CAM-009 lands. */
	get vFov() {
		return PROJECTION.VFOV_ISO;
	}

	/**
	 * setQuake (R-CAM-010).
	 * @param {number} _start
	 * @param {number} [_duration]
	 * @param {number} [_side]
	 * @param {number} [_latitude]
	 * @param {number} [_zoom]
	 */
	setQuake(
		_start,
		_duration = CAMERA.QUAKE_DURATION_MS,
		_side = CAMERA.QUAKE_SIDE,
		_latitude = CAMERA.QUAKE_LATITUDE,
		_zoom = CAMERA.QUAKE_ZOOM
	) {
		notImplemented('Camera.setQuake', 'R-CAM-010');
	}

	/** Schedule the 3 s debounced zoom save, indoor/outdoor separately (R-CAM-011). */
	scheduleZoomSave() {
		notImplemented('Camera.scheduleZoomSave', 'R-CAM-011');
	}

	/** Lerp factor for a frame delta (R-CAM-006). */
	static lerpFactor(dt) {
		return Math.min(dt * CAMERA.LERP_PER_MS, 1.0);
	}

	/** Camera direction index from yaw (R-CAM-008). Literal legacy arithmetic. */
	static directionFromYaw(yaw) {
		return Math.floor((yaw + 22.5) / 45) % 8;
	}

	/**
	 * Per-frame update: smoothing (R-CAM-006), direction (R-CAM-008), view matrix (R-CAM-007).
	 * @param {number} tick
	 */
	update(tick) {
		const lerp = Camera.lerpFactor(tick - this.lastTick);
		this.lastTick = tick;

		const tp = this.target?.position ?? [0, 0, 0];
		const smooth = (this.prefs.smooth ?? true) && this.mode !== 'first';
		const goal = [-tp[0], -tp[1], tp[2]];
		for (let i = 0; i < 3; i++) {
			this.position[i] = smooth ? this.position[i] + (goal[i] - this.position[i]) * lerp : goal[i];
		}

		this.zoom += (this.zoomFinal - this.zoom) * lerp * 2.0;
		this.angle[0] += (this.angleFinal[0] - this.angle[0]) * lerp * 2.0;
		this.angle[1] += (this.angleFinal[1] - this.angle[1]) * lerp * 2.0;
		this.angle[0] %= 360;
		this.angle[1] %= 360;

		this.direction = Camera.directionFromYaw(this.angle[1]);
		this.computeModelView();
	}

	/** R-CAM-007: MV = T_z((altFrom - zoom)/2) · Rx(pitch) · Ry(yaw) · T(pos.x-0.5, pos.z+zOff, pos.y-0.5). */
	computeModelView() {
		const m = identity(this.modelView);
		translate(m, m, [0, 0, (CAMERA.ALTITUDE_FROM - this.zoom) / 2]);
		rotateX(m, m, toRad(this.angle[0]));
		rotateY(m, m, toRad(this.angle[1]));
		const t = [this.position[0] - 0.5, this.position[2] + this.zOffset, this.position[1] - 0.5];
		translate(m, m, t);
		this.focus = t.map(v => -v);

		// normal matrix = inverse-transpose of MV (upper 3x3 meaningful)
		const inv = invert(create(), m) ?? create();
		const n = this.normalMat;
		for (let c = 0; c < 4; c++) {
			for (let r = 0; r < 4; r++) {
				n[c * 4 + r] = inv[r * 4 + c];
			}
		}
		return m;
	}

	/** projection × modelView, for picking/overlays. */
	viewProjection(projection) {
		return multiply(create(), projection, this.modelView);
	}
}
