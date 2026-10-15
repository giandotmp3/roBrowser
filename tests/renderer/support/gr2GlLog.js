/**
 * GL-log helpers for the GR2 record tests: an exact, compact argument serializer and a
 * jsdom stand-in for the emblem canvas (jsdom has no 2D context).
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over the bytes of a typed array (exact: any bit change changes the hash). */
export function hashBytes(view) {
	const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	let h = FNV_OFFSET;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, FNV_PRIME);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

const LONG = 32;

/**
 * One GL argument as text: numbers exactly (String), short vectors in full, long vectors
 * as `#<type>[<length>]:<fnv hash of the bytes>` (plain arrays hashed as Float64), objects
 * by id, image data by size and pixel hash.
 */
export function serializeGl(v) {
	if (v === null || v === undefined || typeof v !== 'object') {
		return String(v);
	}
	if (ArrayBuffer.isView(v) || Array.isArray(v)) {
		if (v.length <= LONG) {
			return `[${Array.from(v, Number).join(',')}]`;
		}
		const typed = ArrayBuffer.isView(v) ? v : Float64Array.from(v);
		return `#${typed.constructor.name}[${v.length}]:${hashBytes(typed)}`;
	}
	if (v.data && v.width) {
		return `image(${v.width}x${v.height}):${hashBytes(v.data)}`;
	}
	return String(v.id ?? '[obj]');
}

/**
 * Replace document.createElement('canvas') with a canvas whose 2D context implements what
 * GR2ModelRenderer.buildEmblemTexture uses (drawImage of an emblem image scaled to the
 * destination box with nearest sampling, getImageData). Calls are logged. Returns restore().
 */
export function installEmblemCanvas(log) {
	const original = document.createElement;
	document.createElement = function createElement(tag, ...rest) {
		if (String(tag).toLowerCase() !== 'canvas') {
			return original.call(this, tag, ...rest);
		}
		const canvas = { width: 0, height: 0, pixels: null };
		const ctx = {
			imageSmoothingEnabled: true,
			drawImage(img, dx, dy, dw, dh) {
				log.push(`@canvas drawImage ${img.id} ${dx} ${dy} ${dw} ${dh} smoothing=${ctx.imageSmoothingEnabled}`);
				const out = canvas.pixels;
				for (let y = 0; y < dh; y++) {
					for (let x = 0; x < dw; x++) {
						const sx = Math.floor((x * img.width) / dw);
						const sy = Math.floor((y * img.height) / dh);
						const s = (sy * img.width + sx) * 4;
						const o = ((dy + y) * canvas.width + dx + x) * 4;
						out.set(img.pixels.subarray(s, s + 4), o);
					}
				}
			},
			getImageData(x, y, w, h) {
				log.push(`@canvas getImageData ${x} ${y} ${w} ${h}`);
				return { width: w, height: h, data: Uint8ClampedArray.from(canvas.pixels) };
			}
		};
		return Object.defineProperties(canvas, {
			width: {
				get: () => canvas._w ?? 0,
				set: w => {
					canvas._w = w;
					canvas.pixels = new Uint8ClampedArray(w * (canvas._h ?? 0) * 4);
				}
			},
			height: {
				get: () => canvas._h ?? 0,
				set: h => {
					canvas._h = h;
					canvas.pixels = new Uint8ClampedArray((canvas._w ?? 0) * h * 4);
				}
			},
			getContext: {
				value: (kind, opts) => {
					log.push(`@canvas getContext ${kind} ${JSON.stringify(opts)}`);
					return ctx;
				}
			}
		});
	};
	return () => {
		document.createElement = original;
	};
}
