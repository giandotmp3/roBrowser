/**
 * Legacy record shim (architecture §2.2 test-harness; §5 phase 1 deliverable).
 *
 * Instruments the legacy `SpriteRenderer` static class so that every sprite draw also
 * emits a SpriteDraw record into a Recorder, *without* changing what legacy draws. The
 * shim is installed by the harness on a legacy build at test time; it never modifies files
 * under legacy/ or src/.
 *
 * Legacy facts mirrored here (src/Renderer/SpriteRenderer.js):
 *   - `render` is re-assigned by bind3DContext/bind2DContext, so it is wrapped through an
 *     accessor, whatever function gets assigned.
 *   - RenderCanvas3D returns early when `!image.texture || !color[3]` (R-SPR-017); such calls
 *     emit no record.
 *   - `zIndex` is read then post-incremented by render (R-SPR-006); the record keeps the
 *     value used for that draw.
 *   - `render(isBlendModeOne)`: true → additive, false → normal, undefined → unchanged
 *     (sticky GL state) (R-SPR-023).
 *   - `runWithDepth(test, write, disableCorrection, fn)` keeps test/write in module-private
 *     variables, so the shim tracks them on its own stack.
 */
import { Blend } from '../records/RecordTypes.js';

const toTextureRef = (image, idOf) =>
	image?.texture
		? {
				id: idOf(image.texture),
				indexed: image.palette != null,
				filter: image.palette != null ? 'nearest' : 'linear'
			}
		: null;

/**
 * @param {object} SpriteRenderer legacy static class (or a same-shape fake)
 * @param {object} opts
 * @param {import('../records/Recorder.js').Recorder} opts.recorder
 * @param {(tex: unknown) => string|number} [opts.textureId] stable id for a GL texture handle
 * @returns {{ withContext: (ctx: object, fn: () => void) => void, setContext: (ctx: object|null) => void, uninstall: () => void }}
 */
export function installLegacyRecordShim(SpriteRenderer, { recorder, textureId } = {}) {
	if (!recorder) {
		throw new TypeError('installLegacyRecordShim: recorder is required');
	}
	const ids = new WeakMap();
	let nextId = 1;
	const idOf =
		textureId ??
		(tex => {
			if (tex === null || typeof tex !== 'object') {
				return String(tex);
			}
			if (!ids.has(tex)) {
				ids.set(tex, `tex${nextId++}`);
			}
			return ids.get(tex);
		});

	let blend = Blend.NORMAL;
	const depthStack = [{ test: true, write: true }];
	let context = null;

	const emit = (sr, isBlendModeOne) => {
		if (isBlendModeOne === true) {
			blend = Blend.ADDITIVE;
		} else if (isBlendModeOne === false) {
			blend = Blend.NORMAL;
		}
		if (!sr.image?.texture || !sr.color?.[3]) {
			return;
		}
		const d = depthStack[depthStack.length - 1];
		recorder.push({
			kind: 'sprite',
			owner: context?.owner ?? null,
			layer: context?.layer ?? 'unknown',
			position: sr.position,
			size: sr.size,
			offset: sr.offset,
			color: sr.color,
			shadow: sr.shadow,
			zIndex: sr.zIndex,
			depthBias: sr.depth,
			angle: sr.angle,
			xSize: sr.xSize,
			ySize: sr.ySize,
			texture: toTextureRef(sr.image, idOf),
			palette: sr.image.palette ? idOf(sr.image.palette) : null,
			blend,
			depth: {
				test: d.test,
				write: d.write,
				correction: !sr.disableDepthCorrection,
				ignoreMinCap: !!sr.ignoreDepthMinCap
			}
		});
	};

	const wrap = fn =>
		fn == null
			? fn
			: function shimmedRender(isBlendModeOne) {
					emit(this, isBlendModeOne);
					return fn.call(this, isBlendModeOne);
				};

	const originalDescriptor = Object.getOwnPropertyDescriptor(SpriteRenderer, 'render');
	let raw = SpriteRenderer.render;
	let current = wrap(raw);
	Object.defineProperty(SpriteRenderer, 'render', {
		configurable: true,
		enumerable: true,
		get: () => current,
		set: fn => {
			raw = fn;
			current = wrap(fn);
		}
	});

	const originalRunWithDepth = SpriteRenderer.runWithDepth;
	SpriteRenderer.runWithDepth = function shimmedRunWithDepth(test, write, disableCorrection, fn) {
		depthStack.push({ test: !!test, write: !!write });
		try {
			return originalRunWithDepth.call(this, test, write, disableCorrection, fn);
		} finally {
			depthStack.pop();
		}
	};

	return {
		setContext(ctx) {
			context = ctx;
		},
		withContext(ctx, fn) {
			const prev = context;
			context = ctx;
			try {
				fn();
			} finally {
				context = prev;
			}
		},
		uninstall() {
			// Restore a plain data property holding whatever legacy assigned last, unwrapped.
			Object.defineProperty(SpriteRenderer, 'render', {
				configurable: true,
				enumerable: originalDescriptor?.enumerable ?? true,
				writable: true,
				value: raw
			});
			SpriteRenderer.runWithDepth = originalRunWithDepth;
		}
	};
}
