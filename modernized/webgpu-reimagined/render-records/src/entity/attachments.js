export const HEAD_ATTACHMENT_LIFT_PX = 100;

/**
 * R-SPR-031 per-record state of a sprite attachment.
 * @param {{opacity?: number, behind?: boolean, head?: boolean, directional?: boolean}} a
 * @param {number} visualDir
 */
export function attachmentRecordState({ opacity = 1, behind = false, head = false, directional = false }, visualDir) {
	return {
		color: [1, 1, 1, opacity],
		zIndex: behind ? 1 : 500,
		depthWrite: false,
		ignoreShadow: behind,
		liftPx: head ? HEAD_ATTACHMENT_LIFT_PX : 0,
		direction: directional ? visualDir : 0
	};
}

/** Legacy attachment sprite folder, 'data/sprite/이펙트/' in CP949 bytes (EntityAttachments.js:85-87). */
export const ATTACHMENT_SPRITE_DIR = 'data/sprite/\xc0\xcc\xc6\xd1\xc6\xae/';

/** R-SPR-031 zIndex an attachment pass starts at (EntityAttachments.js:336). */
export const ATTACHMENT_ZINDEX = Object.freeze({ behind: 1, front: 500 });

/**
 * R-SPR-031 normalised sprite attachment, as legacy AttachmentManager.add leaves it
 * (EntityAttachments.js:51-89). `startTick` is the time the sprite became available: legacy
 * overwrites any given startTick in the load callback (:117-120).
 * STR attachments (`strFile`, R-SPR-032) are not composed here and yield null.
 * @param {Object} def attachment options (uid, file | completeFile, frame, head, opacity, xOffset,
 *        yOffset, repeat, duration, stopAtEnd, delay, depth, renderBefore, ignoreShadow,
 *        animationId, stackable)
 * @param {number} loadTick
 * @returns {Object|null}
 */
export function createAttachment(def, loadTick) {
	if (def.strFile) {
		return null;
	}
	const a = { ...def };
	a.startTick = loadTick;
	// Legacy `!isNaN(opacity)`: undefined → 1, but null / '' coerce to 0
	a.opacity = !Number.isNaN(Number(def.opacity)) ? def.opacity : 1.0;
	// Direction-aware unless a fixed `frame` (ACT action) is given, even frame 0 (:57)
	a.direction = !Object.hasOwn(def, 'frame');
	a.frame = def.frame || 0;
	a.depth = def.depth || 0.0;
	a.head = def.head || false;
	a.position = false;
	if (def.yOffset || def.xOffset) {
		// Legacy keeps offsets in an Int16Array (:64-72)
		a.position = Array.from(new Int16Array([def.xOffset || 0, def.yOffset || 0]));
	}
	a.repeat = def.repeat || false;
	a.duration = def.duration || 0;
	a.stopAtEnd = def.stopAtEnd || false;
	a.delay = def.delay || false;
	a.renderBefore = def.renderBefore || false;
	if (def.completeFile) {
		a.spr = `${def.completeFile}.spr`;
		a.act = `${def.completeFile}.act`;
	} else if (def.file) {
		a.spr = `${ATTACHMENT_SPRITE_DIR}${def.file}.spr`;
		a.act = `${ATTACHMENT_SPRITE_DIR}${def.file}.act`;
	}
	return a;
}

/**
 * Remove every attachment with this uid (legacy remove, EntityAttachments.js:144-155).
 * @param {Object[]} list mutated
 * @param {*} uid
 */
export function removeAttachment(list, uid) {
	for (let i = list.length - 1; i >= 0; --i) {
		if (list[i].uid === uid) {
			list.splice(i, 1);
		}
	}
}

/**
 * Add a normalised attachment (legacy add, EntityAttachments.js:50-123): a non-stackable uid
 * replaces the previous one at once; the attachment joins the list only once its sprite is
 * available (`view.spr`), at the end of the list.
 * @param {Object[]} list mutated
 * @param {Object} attachment createAttachment() result plus `view: {spr, act}`
 */
export function addAttachment(list, attachment) {
	if (attachment.uid && !attachment.stackable) {
		removeAttachment(list, attachment.uid);
	}
	if (attachment.view && attachment.view.spr) {
		list.push(attachment);
	}
}

/**
 * R-SPR-031 attachment frame and lifetime at `tick` (EntityAttachments.js:296-331).
 *  - not started yet: nothing drawn, kept;
 *  - `animationId`: paused on that frame;
 *  - repeating: loops; removed undrawn once `duration` (> 0) has elapsed;
 *  - otherwise plays once and holds the last frame; drawn once more on the last frame and removed
 *    then, unless `stopAtEnd`.
 * @param {Object} a normalised attachment ({startTick, repeat, duration, stopAtEnd, delay,
 *        animationId?}; `frames` may stand in for opts.frames)
 * @param {number} tick
 * @param {{frames?: number, actDelay?: number}} [opts] ACT action frame count and delay (ms)
 * @returns {{started: boolean, draw: boolean, alive: boolean, frame: number}}
 */
export function attachmentLifetime(a, tick, { frames = a.frames, actDelay = 0 } = {}) {
	if (a.startTick > tick) {
		return { started: false, draw: false, alive: true, frame: 0 };
	}
	const delay = Math.max(1, a.delay || actDelay || 100);
	const elapsed = Math.max(0, tick - a.startTick);
	const index = Math.floor(elapsed / delay);
	if ('animationId' in a) {
		return { started: true, draw: true, alive: true, frame: a.animationId };
	}
	if (a.repeat) {
		if (a.duration > 0 && elapsed >= a.duration) {
			return { started: true, draw: false, alive: false, frame: 0 };
		}
		return { started: true, draw: true, alive: true, frame: index % frames };
	}
	const frame = Math.min(index, frames - 1);
	return { started: true, draw: true, alive: !(frame === frames - 1 && !a.stopAtEnd), frame };
}

/**
 * R-SPR-031 sprite-pixel offset of an attachment (EntityAttachments.js:301-307): explicit x/y
 * offsets win; otherwise a head attachment is lifted 100 px (-100 in sprite y).
 * @param {{position: number[]|false, head: boolean}} a
 * @returns {number[]}
 */
export function attachmentOffset({ position, head }) {
	if (position) {
		return [position[0], position[1]];
	}
	return [0, head ? -HEAD_ATTACHMENT_LIFT_PX : 0];
}

/**
 * R-SPR-032 STR attachment scale and offsets.
 * @param {{xSize: number, ySize: number, xOffset?: number, yOffset?: number}} s
 */
export function strAttachmentTransform({ xSize, ySize, xOffset = 0, yOffset = 0 }) {
	const scale = (xSize + ySize) / 2 / 5;
	return {
		scale,
		pivot: [320, 320],
		verticalBase: 0,
		offset: [xOffset * 0.2 * 35 * scale, yOffset * 0.2 * 35 * scale]
	};
}
