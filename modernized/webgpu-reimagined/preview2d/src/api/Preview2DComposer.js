import { CURSOR_CELL_SIZE, FRAME_TYPE } from '../constants.js';
import { NotImplementedError, Preview2DError } from '../errors.js';
import { colorizeFrame } from '../domain/colorize.js';
import { computeDrawTransform } from '../domain/DrawTransform.js';
import { isEmptyFrame } from '../domain/SpriteFrame.js';
import { VariantCache } from '../domain/VariantCache.js';
import { cursorInfo } from '../domain/CursorTypes.js';

/**
 * Preview2DComposer: synchronous Canvas2D composer for **baked** outputs
 * (architecture §2.2 "preview2d", C-19 split, critique B3).
 *
 * Consumers: cursor sheet (toDataURL), guild portrait (getImageData),
 * ItemInfo/ItemCompare icons, CartDecoration, PvPCount. Live previews
 * (CharSelect, Equipment, ...) are NOT here; they render on the GPU backend.
 *
 * Input is the same SpriteDraw record stream that render-records emits for
 * the 3D path; texture/palette handles are resolved to CPU data via FrameSource.
 */
export class Preview2DComposer {
	/** @type {import('../ports.js').CanvasFactory} */
	#canvasFactory;
	/** @type {import('../ports.js').FrameSource} */
	#frames;
	#cache;

	/**
	 * @param {Object} deps
	 * @param {import('../ports.js').CanvasFactory} deps.canvasFactory
	 * @param {import('../ports.js').FrameSource} deps.frameSource
	 * @param {VariantCache} [deps.cache]
	 */
	constructor({ canvasFactory, frameSource, cache } = {}) {
		if (!canvasFactory || typeof canvasFactory.create !== 'function') {
			throw new Preview2DError('canvasFactory port is required');
		}
		if (!frameSource || typeof frameSource.getFrame !== 'function') {
			throw new Preview2DError('frameSource port is required');
		}
		this.#canvasFactory = canvasFactory;
		this.#frames = frameSource;
		this.#cache = cache ?? new VariantCache();
	}

	/** @returns {VariantCache} */
	get cache() {
		return this.#cache;
	}

	/**
	 * Replacement for legacy `SpriteRenderer.bind2DContext(ctx, x, y)`: returns a
	 * target bound to a context and origin, instead of mutating a global.
	 *
	 * @param {import('../ports.js').Context2DLike} ctx
	 * @param {number} x
	 * @param {number} y
	 * @returns {Preview2DTarget}
	 */
	bind(ctx, x, y) {
		return new Preview2DTarget(this, ctx, [x, y]);
	}

	/**
	 * R-SPR-034: colourised canvas for (frame, palette, colour), cached.
	 * Returns null when the frame cannot be drawn (empty, or indexed without palette).
	 */
	variantCanvas(frame, palette, color) {
		if (isEmptyFrame(frame)) {
			return null;
		}
		if (frame.type === FRAME_TYPE.INDEXED && !palette) {
			// Legacy crashed here (fillImageData on undefined palette). Secure default: skip.
			return null;
		}
		return this.#cache.getOrCreate(frame, frame.type === FRAME_TYPE.RGBA ? null : palette, color, () => {
			const canvas = this.#canvasFactory.create(frame.width, frame.height);
			const ctx = canvas.getContext('2d');
			const img = ctx.createImageData(frame.width, frame.height);
			colorizeFrame(frame, palette, color, img.data);
			ctx.putImageData(img, 0, 0);
			return canvas;
		});
	}

	/**
	 * Draw one SpriteDraw record into ctx at origin. Returns true when something was drawn.
	 * @param {import('../ports.js').Context2DLike} ctx
	 * @param {[number, number]} origin
	 * @param {object} record  SpriteDraw (render-records)
	 */
	drawRecord(ctx, origin, record) {
		const frame = this.#frames.getFrame(record.texture);
		if (isEmptyFrame(frame)) {
			return false;
		}
		const palette = frame.type === FRAME_TYPE.INDEXED ? this.#frames.getPalette(record.palette) : null;
		const canvas = this.variantCanvas(frame, palette, record.color ?? [1, 1, 1, 1]);
		if (!canvas) {
			return false;
		}
		const t = computeDrawTransform(record, origin);
		ctx.save();
		ctx.translate(t.tx, t.ty);
		ctx.rotate(t.rotation);
		ctx.scale(t.scaleX, t.scaleY);
		ctx.drawImage(canvas, 0, 0, frame.width, frame.height, t.dx, t.dy, t.dw, t.dh);
		ctx.restore();
		return true;
	}

	/**
	 * Bake the cursor sprite sheet synchronously (R-UI-005, CursorManager.js:480-600).
	 *
	 * Each (action, animation) is drawn into a 50x50 cell with origin (drawX, drawY)
	 * of its type; identical cells (by `toDataURL`) are de-duplicated. Cells are then
	 * laid out left to right into one sheet canvas. Unlike legacy, no blob/Image
	 * round trip is needed: cells are composed directly, synchronously.
	 *
	 * @param {Object} p
	 * @param {ReadonlyArray<{animations: ReadonlyArray<unknown>}>} p.actions  cursor ACT actions
	 * @param {import('../ports.js').CursorRecordSource} p.recordsFor
	 * @returns {{cellIndex: number[][], cellCount: number, sheet: import('../ports.js').CanvasLike}}
	 */
	bakeCursorSheet({ actions, recordsFor }) {
		const S = CURSOR_CELL_SIZE;
		const cells = [];
		const dataURLs = [];
		const cellIndex = [];

		for (let i = 0; i < actions.length; i++) {
			const info = cursorInfo(i);
			cellIndex[i] = [];
			for (let j = 0; j < actions[i].animations.length; j++) {
				const cell = this.#canvasFactory.create(S, S);
				const ctx = cell.getContext('2d');
				ctx.clearRect(0, 0, S, S);
				const target = this.bind(ctx, info.drawX, info.drawY);
				target.drawAll(recordsFor(i, j));

				const url = cell.toDataURL('image/png');
				const pos = dataURLs.indexOf(url);
				if (pos > -1) {
					cellIndex[i][j] = pos;
					continue;
				}
				cellIndex[i][j] = cells.length;
				dataURLs.push(url);
				cells.push(cell);
			}
		}

		const sheet = this.#canvasFactory.create(Math.max(1, cells.length) * S, S);
		const sctx = sheet.getContext('2d');
		cells.forEach((cell, n) => sctx.drawImage(cell, n * S, 0, S, S));
		return { cellIndex, cellCount: cells.length, sheet };
	}

	/**
	 * Guild portrait bake (Guild.js:2337, 2410): render member records into a scratch
	 * canvas and return pixels via getImageData, synchronously.
	 *
	 * @param {Object} _p
	 * @param {ReadonlyArray<object>} _p.records
	 * @param {number} _p.box        portrait box size (px)
	 * @param {number} _p.cellShift  vertical origin shift (px)
	 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
	 */
	bakeGuildPortrait(_p) {
		throw new NotImplementedError('bakeGuildPortrait');
	}

	/**
	 * Item icon bake for ItemInfo / ItemCompare (origin 10, 25), CartDecoration,
	 * PvPCount: draw records into a caller-owned ctx at a fixed origin.
	 *
	 * @param {Object} _p
	 * @param {import('../ports.js').Context2DLike} _p.ctx
	 * @param {[number, number]} _p.origin
	 * @param {ReadonlyArray<object>} _p.records
	 * @returns {number} records drawn
	 */
	bakeIcon(_p) {
		throw new NotImplementedError('bakeIcon');
	}
}

/**
 * A context + origin binding (the stateless replacement for bind2DContext).
 * Implements the `entity.renderEntity2D` facade operation (spec §3.1) for
 * baked consumers: callers pass the records render-records emitted for an Entity.
 */
export class Preview2DTarget {
	#composer;

	/**
	 * @param {Preview2DComposer} composer
	 * @param {import('../ports.js').Context2DLike} ctx
	 * @param {[number, number]} origin
	 */
	constructor(composer, ctx, origin) {
		this.#composer = composer;
		this.ctx = ctx;
		this.origin = Object.freeze([origin[0], origin[1]]);
	}

	/** @param {object} record */
	draw(record) {
		return this.#composer.drawRecord(this.ctx, this.origin, record);
	}

	/**
	 * Draw records in the order given (legacy layer order is preserved by render-records).
	 * @param {Iterable<object>} records
	 * @returns {number} records drawn
	 */
	drawAll(records) {
		let n = 0;
		for (const r of records) {
			if (r && r.kind === 'sprite' && this.draw(r)) {
				n++;
			}
		}
		return n;
	}
}
