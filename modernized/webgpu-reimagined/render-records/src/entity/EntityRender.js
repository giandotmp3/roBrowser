import { notImplemented } from '../util/errors.js';

/**
 * EntityRender mixin. Per AGENTS.md the entity system uses composition: this
 * is applied to an Entity with `EntityRender.call(entity)` — never converted
 * to class inheritance. Instead of drawing through `SpriteRenderer.render()`
 * it emits SpriteDraw records into the injected RecordStream.
 *
 * @this {Object}
 */
export function EntityRender() {
	/**
	 * Emit this entity's layer records for the frame, in legacy order.
	 * @param {import('../records/RecordStream.js').RecordStream} _records
	 * @param {{tick: number, camera: Object, shadowFactorAt?: Function, playing?: boolean}} _frame
	 */
	this.renderRecords = function renderRecords(_records, _frame) {
		notImplemented('R-SPR-007', 'EntityRender.renderRecords layer emission');
	};
}
