/**
 * Harness contract: legacy record shim against a same-shape fake of the legacy
 * SpriteRenderer static class (src/Renderer/SpriteRenderer.js semantics).
 */
import { describe, it, expect } from 'vitest';
import { installLegacyRecordShim } from '../../src/legacy/LegacyRecordShim.js';
import { Recorder } from '../../src/records/Recorder.js';
import { Blend } from '../../src/records/RecordTypes.js';

/** Minimal fake mirroring the legacy mutable "current sprite" + render/runWithDepth. */
function fakeSpriteRenderer() {
	const draws = [];
	const SR = {
		position: new Float32Array(3),
		color: new Float32Array([1, 1, 1, 1]),
		size: new Float32Array([10, 20]),
		offset: new Float32Array(2),
		shadow: 1,
		angle: 0,
		depth: 0,
		zIndex: 0,
		xSize: 5,
		ySize: 5,
		image: { texture: null, palette: null, size: new Float32Array(2) },
		disableDepthCorrection: false,
		ignoreDepthMinCap: false,
		render: null,
		bind3DContext() {
			this.render = function RenderCanvas3D() {
				if (!this.image.texture || !this.color[3]) {
					return;
				}
				draws.push(this.zIndex++);
			};
		},
		runWithDepth(test, write, correction, fn) {
			const prev = this.disableDepthCorrection;
			this.disableDepthCorrection = correction;
			try {
				fn();
			} finally {
				this.disableDepthCorrection = prev;
			}
		}
	};
	return { SR, draws };
}

describe('installLegacyRecordShim', () => {
	it('records every real draw with the zIndex used, after (re)binding render', () => {
		const { SR, draws } = fakeSpriteRenderer();
		const recorder = new Recorder();
		const shim = installLegacyRecordShim(SR, { recorder });
		SR.bind3DContext(); // legacy reassigns render at bind time
		const tex = {};
		SR.image.texture = tex;
		SR.zIndex = 150;
		shim.withContext({ owner: { gid: 7, type: 'pc' }, layer: 'body' }, () => SR.render());
		SR.render();
		expect(draws).toEqual([150, 151]); // legacy behaviour unchanged
		recorder.endFrame();
		const recs = recorder.lastFrame;
		expect(recs.records.map(r => [r.layer, r.zIndex, r.owner?.gid ?? null])).toEqual([
			['body', 150, 7],
			['unknown', 151, null]
		]);
		expect(recs.records[0].texture).toEqual({ id: 'tex1', indexed: false, filter: 'linear' });
	});

	it('skips draws legacy skips (no texture, alpha 0) — R-SPR-017', () => {
		const { SR } = fakeSpriteRenderer();
		const recorder = new Recorder();
		installLegacyRecordShim(SR, { recorder });
		SR.bind3DContext();
		SR.render();
		SR.image.texture = {};
		SR.color[3] = 0;
		SR.render();
		recorder.endFrame();
		expect(recorder.frames).toHaveLength(0);
	});

	it('tracks sticky blend (true/false/undefined) and runWithDepth state', () => {
		const { SR } = fakeSpriteRenderer();
		const recorder = new Recorder();
		installLegacyRecordShim(SR, { recorder });
		SR.bind3DContext();
		SR.image.texture = {};
		SR.render(true);
		SR.render(); // still additive (sticky GL state)
		SR.runWithDepth(true, false, true, () => SR.render(false));
		SR.render();
		recorder.endFrame();
		const r = recorder.lastFrame.records;
		expect(r.map(x => x.blend)).toEqual([Blend.ADDITIVE, Blend.ADDITIVE, Blend.NORMAL, Blend.NORMAL]);
		expect(r[2].depth).toMatchObject({ test: true, write: false, correction: false });
		expect(r[3].depth).toMatchObject({ test: true, write: true, correction: true });
	});

	it('uninstall restores plain render and runWithDepth', () => {
		const { SR } = fakeSpriteRenderer();
		const orig = SR.runWithDepth;
		const shim = installLegacyRecordShim(SR, { recorder: new Recorder() });
		SR.bind3DContext();
		shim.uninstall();
		expect(SR.runWithDepth).toBe(orig);
		expect(SR.render.name).toBe('RenderCanvas3D');
		expect(Object.getOwnPropertyDescriptor(SR, 'render').writable).toBe(true);
	});
});
