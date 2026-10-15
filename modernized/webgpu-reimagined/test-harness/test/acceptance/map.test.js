/** AI_NATIVE_SPEC §5.3 — MAP: ground, water, models, lighting, fog (24 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run } from '../support/scenes.js';
import { flatMap } from '../../src/scenes/fixtures.js';
import { lastFrame, world, worlds, passOrder } from '../../src/subject/queries.js';

const near4 = (a, b, eps = 2 / 255) => {
	expect(Array.from(a)).toHaveLength(b.length);
	b.forEach((v, i) => expect(Math.abs(a[i] - v)).toBeLessThanOrEqual(eps));
};
const clamp = v => Math.min(1, Math.max(0, v));
const water = { level: 0, type: 0, waveHeight: 5, waveSpeed: 2, wavePitch: 50, animSpeed: 3 };

describe('MAP', () => {
	rule(
		'R-MAP-001',
		'ground: tex·tileColor · clamp(max(N·L,0)·D + A) · clamp(env); lightmap rgb·a + clamp(lm.rgb)',
		async s => {
			const inputs = {
				tex: [0.8, 0.6, 0.4, 1],
				tileColor: [0.5, 1, 1, 1],
				tileUV: [0.5, 0.5],
				nDotL: 0.5,
				diffuse: [1, 1, 1],
				ambient: [0.2, 0.2, 0.2],
				env: [1, 1, 1],
				lightmap: [0.1, 0.1, 0.1, 0.5],
				lightmapOn: true,
				smoothlight: 1,
				fog: false
			};
			const out = await s.fragment('ground', inputs);
			const lit = clamp(0.5 * 1 + 0.2);
			const base = [0.8 * 0.5, 0.6, 0.4].map(c => c * lit * 1);
			near4(out, [...base.map(c => c * 0.5 + 0.1), 1]);
			const noTile = await s.fragment('ground', { ...inputs, tileUV: [0, 0], lightmapOn: false });
			near4(noTile, [0.8 * lit, 0.6 * lit, 0.4 * lit, 1]);
		}
	);

	rule(
		'R-MAP-002',
		'smoothlight 0 posterises lightmap to 16 levels; 2 → pow 1.1; 1 raw; lightmap pref off removes term',
		async s => {
			const inputs = {
				tex: [0, 0, 0, 1],
				tileUV: [0, 0],
				nDotL: 0,
				diffuse: [0, 0, 0],
				ambient: [1, 1, 1],
				env: [1, 1, 1],
				lightmap: [0.3, 0.3, 0.3, 0],
				lightmapOn: true,
				fog: false
			};
			const post = c => (Math.floor((c * 255) / 16) * 16) / 255;
			near4(await s.fragment('ground', { ...inputs, smoothlight: 0 }), [post(0.3), post(0.3), post(0.3), 1]);
			near4(await s.fragment('ground', { ...inputs, smoothlight: 2 }), [0.3 ** 1.1, 0.3 ** 1.1, 0.3 ** 1.1, 1]);
			near4(await s.fragment('ground', { ...inputs, smoothlight: 1 }), [0.3, 0.3, 0.3, 1]);
			near4(await s.fragment('ground', { ...inputs, lightmapOn: false }), [0, 0, 0, 1]);
		}
	);

	rule('R-MAP-003', 'ground texels with alpha < 0.1 are discarded', async s => {
		const base = {
			tex: [1, 1, 1, 0.09],
			tileUV: [0, 0],
			nDotL: 1,
			diffuse: [1, 1, 1],
			ambient: [0, 0, 0],
			env: [1, 1, 1],
			lightmapOn: false,
			fog: false
		};
		expect(await s.fragment('ground', base)).toBeNull(); // null = discarded
		expect(await s.fragment('ground', { ...base, tex: [1, 1, 1, 0.1] })).not.toBeNull();
	});

	rule('R-MAP-004', 'fog: smoothstep(near·240, far·240, z/w), rgb mix, alpha kept; no entry → no fog', async s => {
		const fog = { near: 0.1, far: 0.5, color: [1, 0, 0] };
		const dist = 0.3 * 240;
		const t = (dist - 24) / (120 - 24);
		const f = t * t * (3 - 2 * t);
		const out = await s.fragment('fog', { rgba: [0, 0, 1, 0.7], fog, viewDepth: dist, enabled: true });
		near4(out, [f, 0, 1 - f, 0.7]);
		const map = await run(s, inGame('map-004', { map: flatMap({ fog: null }), prefs: { fog: true } }).advance(17));
		expect(lastFrame(map).map.fog.use).toBe(false);
	});

	rule('R-MAP-005', 'ground atlas: grid round(√N) wide, 258 px cells with 1 px border, POT, linear', async s => {
		const a = await s.cpu('loader.groundAtlas', { textureCount: 5, textureSize: 256 });
		expect(a.columns).toBe(Math.round(Math.sqrt(5)));
		expect(a.cellSize).toBe(258);
		expect(Math.log2(a.width) % 1).toBe(0);
		expect(Math.log2(a.height) % 1).toBe(0);
		expect(a.filter).toBe('linear');
	});

	rule('R-MAP-006', 'lightmap atlas: 8×8 blocks, alpha=shadow, rgb=colour, POT, UV inner 0.125–0.875', async s => {
		const a = await s.cpu('loader.lightmapAtlas', { count: 3, shadow: [200], color: [10, 20, 30] });
		expect(a.blockSize).toBe(8);
		expect(Math.log2(a.width) % 1).toBe(0);
		expect(a.texel(0, 0)).toEqual([10, 20, 30, 200]);
		expect(a.uvInset).toEqual([0.125, 0.875]);
	});

	rule('R-MAP-007', 'tile colour bytes BGRA → RGBA; no top tile → 0', async s => {
		const t = await s.cpu('loader.tileColor', { tiles: [{ bgra: [10, 20, 30, 255] }, null] });
		expect(t.colors[0]).toEqual([30, 20, 10, 255]);
		expect(t.colors[1]).toEqual([0, 0, 0, 0]);
	});

	rule('R-MAP-008', 'water wave: frame=t/(1000/60), offset=(frame·s mod 360)−180, height/level = RSW/5', async s => {
		const r = await run(s, inGame('map-008', { map: flatMap({ water }) }).advance(1000, 1));
		const u = world(lastFrame(r), 'water').uniforms;
		const frame = lastFrame(r).tick / (1000 / 60);
		expect(u.waveOffset).toBeCloseTo(((frame * water.waveSpeed) % 360) - 180, 3);
		expect(u.waveHeight).toBeCloseTo(water.waveHeight / 5, 6);
		expect(u.wavePitch).toBe(water.wavePitch);
		expect(u.waterLevel).toBeCloseTo(water.level / 5, 6);
	});

	rule('R-MAP-009', 'water texture index floor(frame/animSpeed) % 32, frame = tick/16.67', async s => {
		const r = await run(s, inGame('map-009', { map: flatMap({ water }) }).advance(5000, 1));
		const f = lastFrame(r);
		expect(world(f, 'water').uniforms.frameIndex).toBe(Math.floor(f.tick / (1000 / 60) / water.animSpeed) % 32);
	});

	rule('R-MAP-010', 'water opacity applied once: type 0 → 0.8 (legacy squared to 0.64); types 4/6 → 1.0', async s => {
		const out = await s.fragment('water', { tex: [0.2, 0.4, 0.6, 0.3], opacity: 0.8, fog: false });
		expect(out[3]).toBeCloseTo(0.8, 2); // fixed; legacy R-MAP-010 gave 0.64
		near4(out.slice(0, 3), [0.2, 0.4, 0.6]); // unlit, texture alpha ignored
		const r = await run(s, inGame('map-010', { map: flatMap({ water: { ...water, type: 4 } }) }).advance(17));
		expect(world(lastFrame(r), 'water').uniforms.opacity).toBe(1);
	});

	rule(
		'R-MAP-011',
		'water quads only where a corner is under water; UV repeat 5 tiles; after entities; test on, write off',
		async s => {
			const g = await s.cpu('loader.waterMesh', {
				heights: [
					[0, 0, 0, 0],
					[-10, -10, -10, -10]
				],
				level: -5
			});
			expect(g.quads).toBe(1);
			expect(g.uvRepeat).toBe(5);
			const r = await run(s, inGame('map-011', { map: flatMap({ water: { ...water, level: 10 } }) }).advance(17));
			const f = lastFrame(r);
			expect(passOrder(f).indexOf('water')).toBeGreaterThan(passOrder(f).indexOf('entities'));
			expect(world(f, 'water').depth).toMatchObject({ test: true, write: false });
		}
	);

	rule(
		'R-MAP-012',
		'static RSM: rgb·clamp(N·L·D + A)·clamp(env); a = tex.a·modelAlpha; a==0 discarded; depth test+write',
		async s => {
			const inputs = {
				tex: [1, 0.5, 0.25, 0.5],
				modelAlpha: 0.5,
				nDotL: 0.5,
				diffuse: [1, 1, 1],
				ambient: [0.1, 0.1, 0.1],
				env: [1, 1, 1],
				lightmapPref: true,
				fog: false
			};
			near4(await s.fragment('models', inputs), [0.6, 0.3, 0.15, 0.25]);
			near4(await s.fragment('models', { ...inputs, lightmapPref: false }), [1, 0.5, 0.25, 0.25]);
			expect(await s.fragment('models', { ...inputs, tex: [1, 1, 1, 0] })).toBeNull();
			const r = await run(s, inGame('map-012').advance(17));
			expect(world(lastFrame(r), 'static-models').depth).toMatchObject({ test: true, write: true });
		}
	);

	rule(
		'R-MAP-013',
		'animated RSM honours the lightmap preference like static models (legacy always applied N·L)',
		async s => {
			const inputs = {
				tex: [1, 1, 1, 1],
				modelAlpha: 1,
				nDotL: 0.2,
				diffuse: [1, 1, 1],
				ambient: [0, 0, 0],
				env: [1, 1, 1],
				fog: false
			};
			const animatedOff = await s.fragment('animated-models', { ...inputs, lightmapPref: false });
			const staticOff = await s.fragment('models', { ...inputs, lightmapPref: false });
			near4(animatedOff, staticOff);
			near4(animatedOff, [1, 1, 1, 1]);
		}
	);

	rule(
		'R-MAP-014',
		'RSM instance: T(pos+offset)·RotZ·RotX·RotY·S; ≥2.2 adds S(flip)·T(offset)·T(0,range.y,0)·T(box.offset)',
		async s => {
			const m = await s.cpu('loader.rsmInstanceMatrix', {
				version: 2.2,
				position: [1, 2, 3],
				rotation: [0, 90, 0],
				scale: [1, 1, 1],
				mapOffset: [0, 0, 0],
				box: { range: [0, 4, 0], offset: [0, 0, 0] },
				flip: [1, -1, 1],
				offset: [0, 0, 0]
			});
			expect(m.order).toEqual([
				'T(pos+mapOffset)',
				'RotZ',
				'RotX',
				'RotY',
				'Scale',
				'Scale(flip)',
				'T(offset)',
				'T(0,range.y,0)',
				'T(box.offset)'
			]);
			const old = await s.cpu('loader.rsmInstanceMatrix', {
				version: 1.4,
				position: [0, 0, 0],
				rotation: [0, 0, 0],
				scale: [1, 1, 1],
				mapOffset: [0, 0, 0]
			});
			expect(old.order).toEqual(['T(pos+mapOffset)', 'RotZ', 'RotX', 'RotY', 'Scale']);
		}
	);

	rule('R-MAP-015', 'RSM normals: NONE constant, FLAT per face, SMOOTH per smoothGroup; unknown → NONE', async s => {
		for (const [shade, mode] of [
			[0, 'none'],
			[1, 'flat'],
			[2, 'smooth'],
			[7, 'none']
		]) {
			expect((await s.cpu('loader.rsmNormals', { shadeType: shade })).mode).toBe(mode);
		}
	});

	rule(
		'R-MAP-016',
		'animated RSM: key = tick % animLen; recompute when floor(frame/(1000/(fps/1.14))) changes; perf fps/2; animLen 0 → max key + 1',
		async s => {
			const model = { filename: 'fixture://rsm/anim', animLen: 1000, frameRatePerSecond: 30, keys: [0, 500] };
			const r = await run(
				s,
				inGame('map-016', { map: flatMap() }).worker('MAP_ANIMATED_MODEL', model).frames(60, 16)
			);
			const step = 1000 / (30 / 1.14);
			const updates = r.frames
				.filter((f, i) => i > 0 && world(f, 'animated-models')?.meta?.recomputed)
				.map(f => f.tick);
			updates.forEach((t, i) => i && expect(Math.floor(t / step)).not.toBe(Math.floor(updates[i - 1] / step)));
			expect(world(lastFrame(r), 'animated-models').meta.keyframe).toBe(lastFrame(r).tick % 1000);
			const derived = await run(
				s,
				inGame('map-016-len')
					.worker('MAP_ANIMATED_MODEL', { ...model, animLen: 0 })
					.advance(16)
			);
			expect(world(lastFrame(derived), 'animated-models').meta.animLen).toBe(501);
		}
	);

	rule(
		'R-MAP-017',
		'node hierarchy: global = parent·T·R(slerp)·S; final = T(−cx,−maxY,−cz)·global·T(offset unless only node)·mat3',
		async s => {
			const out = await s.cpu('records.animatedRsmNodes', {
				nodes: [
					{
						name: 'root',
						parentname: '',
						pos: [0, 0, 0],
						offset: [1, 0, 0],
						mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1]
					},
					{
						name: 'child',
						parentname: 'root',
						pos: [0, 2, 0],
						offset: [0, 0, 0],
						mat3: [1, 0, 0, 0, 1, 0, 0, 0, 1]
					}
				],
				box: { center: [0, 0, 0], max: [0, 3, 0] },
				tick: 0
			});
			expect(out.child.global[13]).toBeCloseTo(2, 5); // parent·T(child.pos)
			expect(out.root.final[12]).toBeCloseTo(1, 5); // root offset applied (not the only node)
			expect(out.root.final[13]).toBeCloseTo(-3, 5); // −max.y
		}
	);

	rule('R-MAP-018', "occluder fade active for 'dither'/'alpha' (default 'off'), except first person", async s => {
		const off = await run(s, inGame('map-018-off').advance(17));
		expect(worlds(lastFrame(off), { layer: 'occluder-query' })).toHaveLength(0);
		const on = await run(s, inGame('map-018-on', { prefs: { occluderFade: 'dither' } }).advance(17));
		expect(worlds(lastFrame(on), { layer: 'occluder-query' }).length).toBeGreaterThan(0);
		const fp = await run(
			s,
			inGame('map-018-1p', { prefs: { occluderFade: 'alpha' }, config: { FirstPersonCamera: true } })
				.camera('setZoom', 0)
				.advance(5000, 1)
		);
		expect(worlds(lastFrame(fp), { layer: 'occluder-query' })).toHaveLength(0);
	});

	rule(
		'R-MAP-019',
		'occlusion query each frame (no colour/depth write), strength +Δt/150 blocked, −Δt/300 clear, Δt≤100, no overlap',
		async s => {
			const r = await run(s, inGame('map-019', { prefs: { occluderFade: 'dither' } }).frames(10, 16));
			const q = worlds(lastFrame(r), { layer: 'occluder-query' })[0];
			expect(q.meta).toMatchObject({ colorWrite: false, axisRadius: 0.7, beforeFocus: 0.5 });
			expect(q.depth.write).toBe(false);
			expect(
				r.frames.every(f => worlds(f, { layer: 'occluder-query' }).filter(x => x.meta.issued).length <= 1)
			).toBe(true);
			const strengths = r.frames.map(f => f.map.occluderStrength);
			strengths.forEach(
				(v, i) => i && expect(Math.abs(v - strengths[i - 1])).toBeLessThanOrEqual(16 / 150 + 1e-9)
			);
		}
	);

	rule(
		'R-MAP-020',
		'fade shape; dither discards vis ≤ Bayer (b+.5)/16; alpha mode blend pass after entities',
		async s => {
			const vis = fade => 1 - fade * (1 - 0.25);
			const d = await s.fragment('occluder-fade', {
				mode: 'dither',
				distanceToAxis: 0,
				signedPastFocus: -1,
				radius: 5,
				strength: 1,
				opacity: 0.25,
				bayerIndex: 15
			});
			expect(vis(1)).toBeLessThanOrEqual((15 + 0.5) / 16);
			expect(d).toBeNull();
			const kept = await s.fragment('occluder-fade', {
				mode: 'dither',
				distanceToAxis: 10,
				signedPastFocus: -1,
				radius: 5,
				strength: 1,
				opacity: 0.25,
				bayerIndex: 15
			});
			expect(kept).not.toBeNull();
			const r = await run(s, inGame('map-020', { prefs: { occluderFade: 'alpha' } }).advance(17));
			const f = lastFrame(r);
			expect(passOrder(f).indexOf('faded-models')).toBeGreaterThan(passOrder(f).indexOf('entities'));
			expect(world(f, 'faded-models').depth).toMatchObject({ test: true, write: false });
		}
	);

	rule(
		'R-MAP-021',
		'grid selector: alpha 0.6, tint rgb(50,240,160), 4 corner heights −0.1; none on non-walkable',
		async s => {
			const map = flatMap({ walkable: x => x !== 25 });
			const hit = await run(
				s,
				inGame('map-021', { map })
					.input({ type: 'mousemove', worldCell: [22, 20] })
					.advance(17)
			);
			const g = world(lastFrame(hit), 'grid');
			expect(g.uniforms).toMatchObject({ alpha: 0.6, tint: [50, 240, 160], lift: 0.1 });
			const miss = await run(
				s,
				inGame('map-021-nw', { map })
					.input({ type: 'mousemove', worldCell: [25, 20] })
					.advance(17)
			);
			expect(world(lastFrame(miss), 'grid')).toBeUndefined();
		}
	);

	rule(
		'R-MAP-022',
		'clouds: 150 × 500 px, cloud1–7, ±35 cells, z −10, 1 s in / 6 s / 2 s out, test on write off',
		async s => {
			const map = flatMap({ sky: { skyColor: [0.5, 0.6, 0.8, 1], cloudColor: [1, 1, 1] } });
			const r = await run(s, inGame('map-022', { map }).advance(500, 1));
			const clouds = lastFrame(r).records.filter(x => x.layer === 'cloud');
			expect(clouds).toHaveLength(150);
			clouds.forEach(c => {
				expect(c.size).toEqual([500, 500]);
				expect(Math.abs(c.position[0] - 20.5)).toBeLessThanOrEqual(35.5);
				expect(c.depth).toMatchObject({ test: true, write: false, correction: false });
				expect(c.color[3]).toBeLessThanOrEqual(0.5 + 1e-6); // still fading in at 500 ms
			});
		}
	);

	rule('R-MAP-023', 'height(x,y): bilinear over the 4 corners at (x+.5,y+.5), negated; outside map → 0', async s => {
		const h = await s.cpu('altitude.height', {
			cells: [{ x: 0, y: 0, heights: [0, 2, 4, 6] }],
			width: 1,
			height: 1,
			at: [0, 0]
		});
		expect(h).toBeCloseTo(-3, 6);
		expect(await s.cpu('altitude.height', { cells: [], width: 1, height: 1, at: [5, 5] })).toBe(0);
	});

	rule('R-MAP-024', 'magenta key: r>230, g<20, b>230 → transparent black; then POT stretch', async s => {
		const out = await s.cpu('residency.colorKey', {
			width: 3,
			height: 1,
			rgba: [231, 19, 231, 255, 230, 0, 255, 255, 255, 20, 255, 255]
		});
		expect(out.rgba.slice(0, 4)).toEqual([0, 0, 0, 0]);
		expect(out.rgba.slice(4, 8)).not.toEqual([0, 0, 0, 0]);
		expect(out.rgba.slice(8, 12)).not.toEqual([0, 0, 0, 0]);
		expect([out.width, out.height]).toEqual([4, 1]);
	});
});
