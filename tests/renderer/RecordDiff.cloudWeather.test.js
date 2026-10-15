/**
 * Phase 2 record-diff of render-records' CloudWeather (EF_CLOUD…EF_CLOUD8 map weather,
 * R-EFX-016) against legacy Renderer/Effects/CloudWeatherEffect.js.
 *
 * Legacy cloud weather draws only through SpriteRenderer (no record seam needed): its
 * native records come from SpriteRenderer.addRecordSink inside ScreenEffectManager's
 * pass. render-records' CloudWeather gets the same profile, events (start, revive, stop,
 * map change), player path and seeded random sequence. Records are diffed per frame,
 * field by field (tolerance 1e-5, relative above 1). Cloud positions accumulate in
 * float32 on both sides.
 *
 * Declared divergences (HITL round 2):
 * - #61 [FLAG, fixed]: render-records picks a cloud's texture over all three textures
 *   (CloudWeather.textureIndex: r·3 | 0) where legacy uses r·(3 − 1) | 0, from the same random
 *   draw. Clouds are sorted by texture and respawns consume the random sequence in that order,
 *   so after the first respawn the whole random assignment differs. Scope: the profile scenes
 *   run render-records with exactly that one function swapped back to legacy's pick
 *   (LegacyPickCloudWeather) and must match field by field. The #61 scenario runs the real
 *   class: until the first respawn (tick ≤ start + 2 s) each frame's clouds, paired by
 *   position, may differ only in `texture` as one draw allows (legacy k → k or k + 1); the
 *   records must be sorted by texture, and the third texture must be drawn.
 * - #60 [FLAG, fixed], EffectTable-spelling scene only: EF_CLOUD2 spawned with `effectID`
 *   gets the EF_CLOUD profile in legacy; render-records reads either spelling. The fixed
 *   records must equal legacy's EF_CLOUD2 records (spawned with the spelling it reads).
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	session: { Entity: null },
	map: { currentMap: '' },
	renderer: { tick: 0, getContext: () => null },
	camera: { zoom: 2, getLatitude: () => -45, angle: [0, 0] }
}));

vi.mock('Utils/WebGL.js', () => ({
	default: {
		createShaderProgram: () => ({ attribute: {}, uniform: {} }),
		texture: (_gl, buffer, onload) => onload({ id: buffer.name })
	}
}));
vi.mock('Core/Client.js', () => ({
	default: { loadFile: (filename, onload) => onload({ name: filename }) }
}));
vi.mock('Renderer/Camera.js', () => ({ default: mocks.camera }));
vi.mock('Renderer/Renderer.js', () => ({ default: mocks.renderer }));
vi.mock('Renderer/MapRenderer.js', () => ({ default: mocks.map }));
vi.mock('Engine/SessionStorage.js', () => ({ default: mocks.session }));

import SpriteRenderer from 'Renderer/SpriteRenderer.js';
import CloudWeatherLegacy from 'Renderer/Effects/CloudWeatherEffect.js';
import { CloudWeather, cloudWeatherTextures } from '../../modernized/webgpu-reimagined/render-records/src/index.js';
import { installDeterminism } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/installDeterminism.js';
import { SeededRng } from '../../modernized/webgpu-reimagined/test-harness/src/determinism/SeededRng.js';
import { makeGl, playerAt } from './support/weatherScene.js';
import { emitterFrames, runEmitterDiff } from './support/emitterWeatherDiff.js';

const FRAMES = emitterFrames({
	stopAt: 21000,
	step: i => (i % 4 ? 130 : 410),
	reviveAt: 21600,
	stop2At: 22400,
	endAt: 25600,
	tailStep: 300
});

/** render-records with only the #61 texture pick swapped back to legacy's r·(3 − 1) | 0. */
class LegacyPickCloudWeather extends CloudWeather {
	textureIndex(r) {
		return (r * (this.textures.length - 1)) | 0;
	}
}

const byPosition = (a, b) => a.position[0] - b.position[0] || a.position[1] - b.position[1] || a.position[2] - b.position[2];

/**
 * #61 scope: pair each frame's clouds by position, excuse only a texture difference one
 * random draw allows (legacy index k → render-records k or k + 1), and check render-records'
 * texture order.
 */
function pairClouds(effectId) {
	const files = cloudWeatherTextures(effectId);
	return (legacy, mine, label) => {
		const extra = [];
		const indices = mine.map(r => files.indexOf(r.texture));
		if (indices.some((k, i) => i > 0 && k < indices[i - 1])) {
			extra.push(`${label}: render-records clouds not sorted by texture`);
		}
		const l = [...legacy].sort(byPosition);
		const m = [...mine].sort(byPosition);
		const paired = l.map((r, i) => {
			const k = files.indexOf(r.texture?.id);
			const km = m[i] ? files.indexOf(m[i].texture) : -1;
			return km === k || km === k + 1 ? { ...r, texture: { id: m[i].texture } } : r;
		});
		return [paired, m, extra];
	};
}

/**
 * @param {number} seed
 * @param {number} effectId
 * @param {object} [opts]
 * @param {number} [opts.mutate] added to render-records' effect id (mutation guard)
 * @param {'effectId'|'effectID'} [opts.legacyKey] id spelling legacy is spawned with
 * @param {'effectId'|'effectID'} [opts.modernKey] id spelling render-records is spawned with
 * @param {typeof CloudWeather} [opts.Cloud] render-records class (default: legacy texture pick)
 * @param {function} [opts.prepareFrame]
 */
function run(
	seed,
	effectId,
	{ mutate = 0, legacyKey = 'effectId', modernKey = 'effectId', Cloud = LegacyPickCloudWeather, prepareFrame } = {}
) {
	const rng = new SeededRng(seed).fn;
	const { restore } = installDeterminism({ rng: new SeededRng(seed) });
	const used = new Set();
	try {
		const result = runEmitterDiff({
			Legacy: CloudWeatherLegacy,
			SpriteRenderer,
			gl: makeGl(),
			mocks,
			frames: FRAMES,
			params: tick => ({ Inst: { [legacyKey]: effectId, startTick: tick, endTick: -1 }, Init: { ownerAID: -1 } }),
			create: (tick, p) => {
				const cloud = new Cloud({ [modernKey]: effectId + mutate, startTick: tick }, { rng });
				cloud.setUp(p.Inst.startTick, playerAt(tick));
				const frame = cloud.frame.bind(cloud);
				cloud.frame = (t, ctx) => {
					const records = frame(t, ctx);
					records.forEach(r => used.add(cloud.textures.indexOf(r.texture)));
					return records;
				};
				return cloud;
			},
			frameCtx: (tick, player) => ({ player }),
			textureKey: t => t?.id,
			prepareFrame
		});
		return { ...result, used };
	} finally {
		restore();
	}
}

describe('CloudWeather record-diff (legacy vs render-records)', { timeout: 60000 }, () => {
	it.each([
		['EF_CLOUD (overlay)', 229, 0xc1],
		['EF_CLOUD2', 230, 0xc2],
		['EF_CLOUD3 (fog textures, overlay)', 233, 0xc3],
		['EF_CLOUD5', 516, 0xc5],
		['EF_CLOUD8', 698, 0xc8],
		['unknown id (EF_CLOUD profile)', 4242, 0xc9]
	])('reproduces every legacy %s record field by field (with the legacy texture pick, #61)', (_name, effectId, seed) => {
		const { mismatches, records, used } = run(seed, effectId);
		expect(mismatches.slice(0, 20)).toEqual([]);
		expect(records).toBeGreaterThan(3000);
		expect(used.has(2)).toBe(false);
	});

	it.each([
		['EF_CLOUD', 229, 0xc1],
		['EF_CLOUD3 (fog textures)', 233, 0xc3]
	])('#61 divergence (%s): all three textures; until the first respawn only the texture pick differs', (_n, effectId, seed) => {
		const start = FRAMES[0].tick;
		const beforeRespawn = m => Number(m.match(/@(\d+)/)[1]) <= start + 2000;
		const raw = run(seed, effectId, { Cloud: CloudWeather });
		expect(raw.mismatches.filter(beforeRespawn).some(m => / texture: /.test(m))).toBe(true);
		const { mismatches, used } = run(seed, effectId, { Cloud: CloudWeather, prepareFrame: pairClouds(effectId) });
		expect(mismatches.filter(beforeRespawn)).toEqual([]);
		expect(mismatches.some(m => m.includes('not sorted'))).toBe(false);
		expect(used).toEqual(new Set([0, 1, 2]));
	});

	it('#60 divergence: EF_CLOUD2 spawned with the EffectTable spelling keeps its own profile', () => {
		// legacy reads only effectId: with effectID it falls back to the EF_CLOUD profile
		const legacyWrong = run(0xc2, 230, { legacyKey: 'effectID', modernKey: 'effectID' });
		expect(legacyWrong.mismatches.some(m => / color: /.test(m))).toBe(true);
		expect(legacyWrong.mismatches.length).toBeGreaterThan(100);
		// render-records from the EffectTable spelling = legacy EF_CLOUD2 from the spelling it reads
		const fixed = run(0xc2, 230, { legacyKey: 'effectId', modernKey: 'effectID' });
		expect(fixed.mismatches.slice(0, 20)).toEqual([]);
		expect(fixed.records).toBeGreaterThan(3000);
	});

	it('fails the diff when the profile is wrong (mutation guard)', () => {
		expect(run(0xc2, 230, { mutate: 3 }).mismatches.length).toBeGreaterThan(100);
	});
});
