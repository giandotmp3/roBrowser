/** AI_NATIVE_SPEC §5.4 — SPR: sprites and entities (34 rules). */
import { describe, expect } from 'vitest';
import { rule } from '../support/rule.js';
import { inGame, run, LOCAL_GID } from '../support/scenes.js';
import { pc, mob, npc, homun, merc, falcon, pet, warp } from '../../src/scenes/fixtures.js';
import { lastFrame, layersOf, sprites, inPass, passOrder } from '../../src/subject/queries.js';
import { Blend } from '../../src/records/RecordTypes.js';

const G = 120_100_000;
const zOf = (frame, gid, layer) => layersOf(frame, gid).find(l => l.layer === layer)?.zIndex;
const near3 = (a, b, eps = 1e-4) => {
	expect(Array.from(a)).toHaveLength(b.length);
	b.forEach((v, i) => expect(a[i]).toBeCloseTo(v, -Math.log10(eps)));
};

describe('SPR', () => {
	rule(
		'R-SPR-001',
		'visual dir = (camDir + entityDir + 8) % 8; act = (action·8 + dir) % n; negative action → IDLE',
		async s => {
			const r = await run(
				s,
				inGame('spr-001', { prefs: { smooth: false } })
					.camera('rotate', 50)
					.entity(mob({ gid: G + 1, direction: 3, action: 2 }))
					.advance(16)
			);
			const body = layersOf(lastFrame(r), G + 1).find(l => l.layer === 'body');
			expect(body.direction).toBe(4);
			expect(body.action).toBe(2 * 8 + 4);
			const neg = await run(
				s,
				inGame('spr-001-neg')
					.entity(mob({ gid: G + 2, action: -1 }))
					.advance(16)
			);
			const idle = layersOf(lastFrame(neg), G + 2).find(l => l.layer === 'body');
			expect(idle.action).toBe(0 * 8 + idle.direction); // IDLE = action 0
		}
	);

	rule('R-SPR-002', 'spherical billboard: rotation replaced by identity after translating to the sprite', async s => {
		const a = await s.fragment('sprite.vertex', { position: [10, 0, 10], corner: [1, 1], yaw: 0, pitch: 230 });
		const b = await s.fragment('sprite.vertex', { position: [10, 0, 10], corner: [1, 1], yaw: 90, pitch: 230 });
		// view-space corner offset is identical whatever the camera rotation
		expect(typeof a.viewOffset[0]).toBe('number');
		near3([a.viewOffset[0], a.viewOffset[1]], [b.viewOffset[0], b.viewOffset[1]]);
	});

	rule('R-SPR-003', 'world size = px/175·xSize (5; baby 4; warp 20); offsets same, minus 0.5 on Y', async s => {
		const r = await run(
			s,
			inGame('spr-003')
				.entity(pc({ gid: G + 3, baby: true }))
				.entity(warp({ gid: G + 4 }))
				.advance(16)
		);
		const f = lastFrame(r);
		expect(layersOf(f, LOCAL_GID).find(l => l.layer === 'body').xSize).toBe(5);
		expect(layersOf(f, G + 3).find(l => l.layer === 'body').xSize).toBe(4);
		expect(layersOf(f, G + 4).find(l => l.layer === 'body').xSize).toBe(20);
		const geo = await s.cpu('records.spriteWorldGeometry', { size: [35, 70], offset: [0, 35], xSize: 5, ySize: 5 });
		expect(geo.size).toEqual([1, 2]);
		expect(geo.offset).toEqual([0, 0.5]);
	});

	rule('R-SPR-004', 'body drawn 0.2 cells above position; pick rect uses the same lift', async s => {
		const r = await run(s, inGame('spr-004').advance(16));
		const f = lastFrame(r);
		const body = layersOf(f, LOCAL_GID).find(l => l.layer === 'body');
		expect(body.meta.lift).toBe(0.2);
		expect(f.pickRects.find(p => p.gid === LOCAL_GID).lift).toBe(0.2);
	});

	rule(
		'R-SPR-005',
		'depth correction: ray/vertical-plane depth; min(original, corrected) unless ignoreDepthMinCap (NPC)',
		async s => {
			const base = { center: [10, 0, 10], vertex: [0.5, 2], cameraForward: [0, -0.7, -0.7] };
			const pcV = await s.fragment('sprite.depth', { ...base, ignoreMinCap: false });
			const npcV = await s.fragment('sprite.depth', { ...base, ignoreMinCap: true });
			expect(pcV.z).toBeCloseTo(Math.min(pcV.originalZ, pcV.correctedZ), 6);
			expect(npcV.z).toBeCloseTo(npcV.correctedZ, 6);
			const r = await run(
				s,
				inGame('spr-005')
					.entity(npc({ gid: G + 5 }))
					.advance(16)
			);
			expect(layersOf(lastFrame(r), G + 5)[0].depth.ignoreMinCap).toBe(true);
		}
	);

	rule('R-SPR-006', 'clip.z −= (zIndex·0.01 + depth)/max(zoom,1); zIndex auto-increments per draw', async s => {
		const v = await s.fragment('sprite.depth', {
			center: [0, 0, 0],
			vertex: [0, 0],
			zIndex: 150,
			depthBias: 0,
			zoom: 125,
			correction: false
		});
		expect(v.originalZ - v.z).toBeCloseTo((150 * 0.01) / 125, 6);
		const r = await run(s, inGame('spr-006').advance(16));
		const z = layersOf(lastFrame(r), LOCAL_GID).map(l => l.zIndex);
		expect(new Set(z).size).toBe(z.length); // later layers win ties
	});

	rule(
		'R-SPR-007',
		'PC layer z-order (bodyZ 250): shadow −1, cart 1, body 150, head 300, hats 350/450/550, weapon 500, shield 550',
		async s => {
			const r = await run(
				s,
				inGame('spr-007')
					.entity(pc({ gid: G + 7, full: true, direction: 0 }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(zOf(f, G + 7, 'shadow')).toBe(-1);
			expect(zOf(f, G + 7, 'cart')).toBe(1);
			expect(zOf(f, G + 7, 'body')).toBe(150);
			expect(zOf(f, G + 7, 'head')).toBe(300);
			expect(zOf(f, G + 7, 'hat-mid')).toBe(350);
			expect(zOf(f, G + 7, 'hat-top')).toBe(450);
			expect(zOf(f, G + 7, 'hat-low')).toBe(550);
			expect(zOf(f, G + 7, 'weapon')).toBe(500);
			expect(zOf(f, G + 7, 'shield')).toBe(550);
			expect(layersOf(f, G + 7).find(l => l.layer === 'cart').depth.write).toBe(false);
			const back = await run(
				s,
				inGame('spr-007-back')
					.entity(pc({ gid: G + 8, full: true, direction: 4 }))
					.advance(16)
			);
			const b = lastFrame(back);
			expect(zOf(b, G + 8, 'shield')).toBe(-1);
			expect(zOf(b, G + 8, 'cart')).toBe(250 + 500);
			const order = layersOf(b, G + 8).map(l => l.layer);
			expect(order.indexOf('robe')).toBeGreaterThan(order.indexOf('hat-top'));
		}
	);

	rule('R-SPR-008', 'mid hat skipped if == lower; top skipped if == lower or mid', async s => {
		const same = 'fixture://hat/same';
		const r = await run(
			s,
			inGame('spr-008')
				.entity(
					pc({
						gid: G + 9,
						views: { body: 'b', head: 'h', accessory: same, accessory2: same, accessory3: same }
					})
				)
				.advance(16)
		);
		const hats = layersOf(lastFrame(r), G + 9).filter(l => l.layer.startsWith('hat-'));
		expect(hats.map(h => h.layer)).toEqual(['hat-low']);
	});

	rule(
		'R-SPR-009',
		'robe z: default front 1 / back 400; sitting −100/550; tall robe −300/1(100 riding); sitting tall −450/−100(1 riding)',
		async s => {
			const cases = [
				[{ direction: 0 }, 250 + 1],
				[{ direction: 4 }, 250 + 400],
				[{ direction: 0, action: 'sit' }, 250 - 100],
				[{ direction: 4, action: 'sit' }, 250 + 550],
				[{ direction: 0, tallRobe: true }, 250 - 300],
				[{ direction: 4, tallRobe: true }, 250 + 1]
			];
			for (const [o, z] of cases) {
				const r = await run(
					s,
					inGame('spr-009')
						.entity(pc({ gid: G + 10, full: true, ...o }))
						.advance(16)
				);
				expect(zOf(lastFrame(r), G + 10, 'robe')).toBe(z);
			}
		}
	);

	rule(
		'R-SPR-010',
		'cart pixel offsets by visual dir; Super Novice cart 0; only while playing; idle frame 0',
		async s => {
			const OFF = [
				[0, -30],
				[30, -10],
				[40, 0],
				[30, 10],
				[0, 20],
				[-30, 10],
				[-40, 0],
				[-30, -10]
			];
			for (let d = 0; d < 8; d++) {
				const r = await run(
					s,
					inGame('spr-010')
						.entity(pc({ gid: G + 11, full: true, direction: d }))
						.advance(16)
				);
				const cart = layersOf(lastFrame(r), G + 11).find(l => l.layer === 'cart');
				expect(cart.meta.pixelOffset).toEqual(OFF[d]);
				expect(cart.frame).toBe(0);
			}
			const off = await run(
				s,
				inGame('spr-010-np')
					.session({ playing: false })
					.entity(pc({ gid: G + 12, full: true }))
					.advance(16)
			);
			expect(layersOf(lastFrame(off), G + 12).find(l => l.layer === 'cart')).toBeUndefined();
		}
	);

	rule(
		'R-SPR-011',
		'shadow unless DIE/SIT/job 45/hideShadow; height+0.05; frame 0; ShadowTable scale; no effectColor; test on, write off',
		async s => {
			const r = await run(
				s,
				inGame('spr-011')
					.entity(mob({ gid: G + 13, states: { bodyState: 'stone' } }))
					.entity(pc({ gid: G + 14, action: 'sit' }))
					.entity(warp({ gid: G + 15 }))
					.advance(16)
			);
			const f = lastFrame(r);
			const sh = layersOf(f, G + 13).find(l => l.layer === 'shadow');
			expect(sh.frame).toBe(0);
			expect(sh.color).toEqual([1, 1, 1, 1]);
			expect(sh.depth).toMatchObject({ test: true, write: false, correction: true });
			expect(sh.meta.heightLift).toBe(0.05);
			expect(layersOf(f, G + 14).find(l => l.layer === 'shadow')).toBeUndefined();
			expect(layersOf(f, G + 15).find(l => l.layer === 'shadow')).toBeUndefined();
		}
	);

	rule('R-SPR-012', 'shadow factor = 6×6 shadowmap average /255 (no ground = 255); 1.0 before map load', async s => {
		const f = await s.cpu('records.shadowFactor', { shadowMap: { width: 8, height: 8, fill: 51 }, at: [0.5, 0.5] });
		expect(f).toBeCloseTo(51 / 255, 6);
		expect(await s.cpu('records.shadowFactor', { shadowMap: null, at: [0, 0] })).toBe(1);
		const r = await run(s, inGame('spr-012').advance(16));
		expect(layersOf(lastFrame(r), LOCAL_GID).find(l => l.layer === 'body').shadow).toBe(1);
	});

	rule(
		'R-SPR-013',
		'depth write for PC/merc/hom/falcon/NPC bodies; mobs test only; falcon zIndex 1000, others 150',
		async s => {
			const ents = [
				[pc({ gid: G + 16 }), true],
				[merc({ gid: G + 17 }), true],
				[homun({ gid: G + 18 }), true],
				[npc({ gid: G + 19 }), true],
				[mob({ gid: G + 20 }), false],
				[pet({ gid: G + 21 }), false]
			];
			const sc = inGame('spr-013').entity(falcon({ gid: G + 22 }));
			ents.forEach(([e]) => sc.entity(e));
			const f = lastFrame(await run(s, sc.advance(16)));
			for (const [e, write] of ents) {
				expect(layersOf(f, e.gid).find(l => l.layer === 'body').depth).toMatchObject({ test: true, write });
			}
			expect(zOf(f, G + 22, 'body')).toBe(1000);
		}
	);

	rule(
		'R-SPR-014',
		'indexed frames: r8 POT-centred, magenta index → 0, index 0 transparent, 4-tap palette bilinear, NEAREST',
		async s => {
			const t = await s.cpu('residency.indexedFrame', {
				width: 3,
				height: 3,
				indices: [0, 1, 2, 1, 1, 1, 2, 2, 2],
				palette: { 1: [255, 0, 255], 2: [10, 20, 30] }
			});
			expect([t.width, t.height]).toEqual([4, 4]);
			expect(t.indexAt(1, 1)).toBe(0); // magenta palette entry mapped to 0
			expect(t.filter).toBe('nearest');
			expect(await s.fragment('sprite', { indexed: true, index: 0, palette: [[0, 0, 0, 0]] })).toBeNull();
			const rgba = await s.cpu('residency.rgbaFrame', { pixelPerfectSprites: false });
			expect(rgba.filter).toBe('linear');
			expect((await s.cpu('residency.rgbaFrame', { pixelPerfectSprites: true })).filter).toBe('nearest');
		}
	);

	rule(
		'R-SPR-015',
		'external .pal when set, else sprite palette; mounted/costume use the drawn sprite palette',
		async s => {
			const r = await run(
				s,
				inGame('spr-015')
					.entity(pc({ gid: G + 23, bodyPalette: 'fixture://pal/body-3', headPalette: null }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(layersOf(f, G + 23).find(l => l.layer === 'body').palette).toBe('fixture://pal/body-3');
			expect(layersOf(f, G + 23).find(l => l.layer === 'head').palette).toBe('sprite:fixture://pc/head');
		}
	);

	rule('R-SPR-016', 'RGBA frames: flipped vertically, ABGR → RGBA, alpha 0 zeroes the pixel', async s => {
		const out = await s.cpu('loader.spriteRgba', { width: 1, height: 2, abgr: [255, 1, 2, 3, 0, 9, 9, 9] });
		expect(out.rgba).toEqual([0, 0, 0, 0, 3, 2, 1, 255]);
	});

	rule(
		'R-SPR-017',
		'colour = layer.colour/255 × effectColor; rgb ×= shadow; tex.a 0 discarded; colour.a 0 skips the draw',
		async s => {
			const out = await s.fragment('sprite', {
				indexed: false,
				tex: [1, 1, 1, 1],
				color: [0.5, 1, 1, 1],
				shadow: 0.5
			});
			expect(out).toEqual([0.25, 0.5, 0.5, 1]);
			expect(
				await s.fragment('sprite', { indexed: false, tex: [1, 1, 1, 0], color: [1, 1, 1, 1], shadow: 1 })
			).toBeNull();
			const r = await run(
				s,
				inGame('spr-017')
					.entity(mob({ gid: G + 24, states: { option: 'invisible' } }))
					.advance(16)
			);
			expect(layersOf(lastFrame(r), G + 24)).toHaveLength(0);
		}
	);

	rule('R-SPR-018', 'effectColor = bodyState × healthState × effectState × virtue × flash per channel', async s => {
		const r = await run(
			s,
			inGame('spr-018')
				.entity(mob({ gid: G + 25, states: { healthState: 'poison', virtue: 'berserk' } }))
				.advance(16)
		);
		const body = layersOf(lastFrame(r), G + 25).find(l => l.layer === 'body');
		near3(body.color.slice(0, 3), [0.9 * 1, 0.4 * 0.4, 0.8 * 0.4]);
	});

	rule('R-SPR-019', 'stone rgb 0.1 paused; stone-wait 0.3; freeze (0,.4,.8) + ice + FREEZE2', async s => {
		const cases = [
			['stone', [0.1, 0.1, 0.1]],
			['stone-wait', [0.3, 0.3, 0.3]],
			['freeze', [0, 0.4, 0.8]]
		];
		for (const [state, rgb] of cases) {
			const r = await run(
				s,
				inGame('spr-019')
					.entity(mob({ gid: G + 26, states: { bodyState: state } }))
					.advance(16)
			);
			near3(
				layersOf(lastFrame(r), G + 26)
					.find(l => l.layer === 'body')
					.color.slice(0, 3),
				rgb
			);
		}
		const fr = await run(
			s,
			inGame('spr-019-f')
				.entity(mob({ gid: G + 27, states: { bodyState: 'freeze' } }))
				.advance(16)
		);
		expect(layersOf(lastFrame(fr), G + 27).some(l => l.layer === 'attachment')).toBe(true);
	});

	rule(
		'R-SPR-020',
		'curse ×(.5,.15,.1) + attachment @0.5; poison ×(.9,.4,.8); silence emotion attachment depth 5',
		async s => {
			const r = await run(
				s,
				inGame('spr-020')
					.entity(mob({ gid: G + 28, states: { healthState: 'curse' } }))
					.advance(16)
			);
			const ls = layersOf(lastFrame(r), G + 28);
			near3(ls.find(l => l.layer === 'body').color.slice(0, 3), [0.5, 0.15, 0.1]);
			expect(ls.find(l => l.layer === 'attachment').color[3]).toBeCloseTo(0.5, 5);
		}
	);

	rule(
		'R-SPR-021',
		'INVISIBLE/hide/cloak/chasewalk α 0 (black w/ intravision); camouflage/stealth 0.1; shadow form 0.2',
		async s => {
			const r = await run(
				s,
				inGame('spr-021')
					.entity(mob({ gid: G + 29, states: { option: 'camouflage' } }))
					.entity(mob({ gid: G + 30, states: { option: 'shadowform' } }))
					.advance(16)
			);
			const f = lastFrame(r);
			expect(layersOf(f, G + 29).find(l => l.layer === 'body').color[3]).toBeCloseTo(0.1, 5);
			expect(layersOf(f, G + 30).find(l => l.layer === 'body').color).toEqual([0.2, 0.2, 0.2, 0.2]);
			const iv = await run(
				s,
				inGame('spr-021-iv')
					.session({ playing: true, localGid: LOCAL_GID, intravision: true })
					.entity(mob({ gid: G + 31, states: { option: 'hide' } }))
					.advance(16)
			);
			const body = layersOf(lastFrame(iv), G + 31).find(l => l.layer === 'body');
			expect(body.color.slice(0, 3)).toEqual([0, 0, 0]);
		}
	);

	rule('R-SPR-022', 'virtue tints (quicken B=0, berserk (1,.4,.4), …); later checks overwrite earlier', async s => {
		const r = await run(
			s,
			inGame('spr-022')
				.entity(mob({ gid: G + 32, states: { virtue: ['quicken', 'berserk'] } }))
				.advance(16)
		);
		near3(
			layersOf(lastFrame(r), G + 32)
				.find(l => l.layer === 'body')
				.color.slice(0, 3),
			[1, 0.4, 0.4]
		);
	});

	rule('R-SPR-023', 'berserk (non-shadow) or marionette → additive SRC_ALPHA, ONE', async s => {
		const r = await run(
			s,
			inGame('spr-023')
				.entity(mob({ gid: G + 33, states: { virtue: 'berserk' } }))
				.advance(16)
		);
		const ls = layersOf(lastFrame(r), G + 33);
		expect(ls.find(l => l.layer === 'body').blend).toEqual(Blend.ADDITIVE);
		expect(ls.find(l => l.layer === 'shadow').blend).toEqual(Blend.NORMAL);
	});

	rule('R-SPR-024', 'Assumptio halo: each layer redrawn ×1.15, (1,1,1,.6), zIndex −100, no depth write', async s => {
		const r = await run(
			s,
			inGame('spr-024')
				.entity(pc({ gid: G + 34, states: { effectState: 'assumptio' } }))
				.advance(16)
		);
		const halos = layersOf(lastFrame(r), G + 34).filter(l => l.layer === 'halo');
		expect(halos.length).toBeGreaterThan(0);
		halos.forEach(h => {
			expect(h.color).toEqual([1, 1, 1, 0.6]);
			expect(h.zIndex).toBe(-100);
			expect(h.depth.write).toBe(false);
			expect(h.meta.scale).toBe(1.15);
		});
	});

	rule(
		'R-SPR-025',
		'trails every 80 ms (560/30), ≤5 (perf 2), α=0.4(1−age/dur), <0.05 dropped, zIndex −10−i',
		async s => {
			const r = await run(
				s,
				inGame('spr-025')
					.entity(pc({ gid: G + 35, states: { virtue: 'quicken' }, action: 'walk', walkTo: [30, 20] }))
					.frames(30, 16)
			);
			const trails = layersOf(lastFrame(r), G + 35).filter(l => l.layer === 'trail');
			expect(trails.length).toBeGreaterThan(0);
			const snaps = new Set(trails.map(t => t.meta.snapshot));
			expect(snaps.size).toBeLessThanOrEqual(5);
			trails.forEach(t => {
				expect(t.color[3]).toBeGreaterThanOrEqual(0.05);
				expect(t.color[3]).toBeLessThanOrEqual(0.4);
				expect(t.depth.write).toBe(false);
			});
			const perf = await run(
				s,
				inGame('spr-025-p', { prefs: { performanceMode: true } })
					.entity(pc({ gid: G + 36, states: { virtue: 'quicken' }, action: 'walk', walkTo: [30, 20] }))
					.frames(30, 16)
			);
			expect(
				new Set(
					layersOf(lastFrame(perf), G + 36)
						.filter(l => l.layer === 'trail')
						.map(t => t.meta.snapshot)
				).size
			).toBeLessThanOrEqual(2);
		}
	);

	rule(
		'R-SPR-026',
		'out of sight 1000 ms fade; non-PC death DIE + 5000 ms; dying PC not removed; other removal instant',
		async s => {
			const r = await run(
				s,
				inGame('spr-026')
					.entity(mob({ gid: G + 37 }))
					.advance(16)
					.removeEntity(G + 37, 'out-of-sight')
					.advance(500, 1)
					.advance(600, 1)
			);
			const alpha = layersOf(r.frames[1], G + 37).find(l => l.layer === 'body').color[3];
			expect(alpha).toBeCloseTo(1 - 500 / 1000, 2);
			expect(layersOf(r.frames[2], G + 37)).toHaveLength(0);
			const pcDie = await run(
				s,
				inGame('spr-026-pc')
					.entity(pc({ gid: G + 38 }))
					.removeEntity(G + 38, 'death')
					.advance(6000, 1)
			);
			expect(layersOf(lastFrame(pcDie), G + 38).length).toBeGreaterThan(0);
			const tele = await run(
				s,
				inGame('spr-026-t')
					.entity(mob({ gid: G + 39 }))
					.removeEntity(G + 39, 'teleport')
					.advance(16)
			);
			expect(layersOf(lastFrame(tele), G + 39)).toHaveLength(0);
		}
	);

	rule(
		'R-SPR-027',
		'delay = ACT×25 ms or 150; attack ACT delay else aspd/frames ≥100; idle PC body frame = headDir',
		async s => {
			const r = await run(
				s,
				inGame('spr-027')
					.entity(pc({ gid: G + 40, headDir: 2 }))
					.advance(16)
			);
			expect(layersOf(lastFrame(r), G + 40).find(l => l.layer === 'body').frame).toBe(2);
			const a = await s.cpu('records.frameDelay', { actDelay: 4, action: 'idle' });
			expect(a).toBe(100);
			expect(await s.cpu('records.frameDelay', { actDelay: 0, action: 'idle' })).toBe(150);
			expect(
				await s.cpu('records.frameDelay', { actDelay: 0, action: 'attack', attackSpeed: 200, frames: 4 })
			).toBe(100);
		}
	);

	rule(
		'R-SPR-028',
		'walk frame = floor(dist·170.2/delay) % motions; dist 2, delay 100 → 3; shared phase; falcons excluded',
		async s => {
			expect(await s.cpu('records.walkFrame', { distance: 2, delay: 100, motionCount: 8 })).toBe(3);
			const r = await run(
				s,
				inGame('spr-028')
					.entity(pc({ gid: G + 41, full: true, action: 'walk', walkTo: [25, 20] }))
					.advance(200, 1)
			);
			const frames = layersOf(lastFrame(r), G + 41)
				.filter(l => ['body', 'head', 'weapon'].includes(l.layer))
				.map(l => l.meta.walkPhase);
			expect(new Set(frames).size).toBe(1);
		}
	);

	rule(
		'R-SPR-029',
		'lookTo: 1–2 steps turn the head only; larger turn rotates body and straightens head',
		async s => {
			const r = await run(
				s,
				inGame('spr-029')
					.entity(pc({ gid: G + 42, direction: 0 }))
					.updateEntity(G + 42, { lookTo: 1 })
					.advance(16)
					.updateEntity(G + 42, { lookTo: 4 })
					.advance(16)
			);
			const [a, b] = r.frames.map(f => layersOf(f, G + 42).find(l => l.layer === 'body'));
			expect(a.meta.headDir).not.toBe(0);
			expect(b.meta.headDir).toBe(0);
			expect(b.meta.bodyDir).toBe(4);
		}
	);

	rule(
		'R-SPR-030',
		'far→near by clip w + (GID%100)/1000; resort on change or every 3 frames (6 perf); effect entities after water',
		async s => {
			const r = await run(
				s,
				inGame('spr-030')
					.entity(mob({ gid: G + 50, position: [20, 30, 0] }))
					.entity(mob({ gid: G + 51, position: [20, 10, 0] }))
					.advance(16)
			);
			const f = lastFrame(r);
			const order = sprites(f, { layer: 'body' }).map(l => l.owner.gid);
			const depth = gid => f.entityDepth[gid];
			for (let i = 1; i < order.length; i++) {
				expect(depth(order[i - 1])).toBeGreaterThanOrEqual(depth(order[i]));
			}
			expect(inPass(f, 'effect-entities').every(x => x.owner?.type === 'effect')).toBe(true);
			expect(passOrder(f).indexOf('effect-entities')).toBeGreaterThan(passOrder(f).indexOf('water'));
		}
	);

	rule(
		'R-SPR-031',
		'attachments: white×opacity, head +100 px, zIndex 1 behind / 500 front, no depth write, behind ignores shadow',
		async s => {
			const r = await run(
				s,
				inGame('spr-031')
					.entity(mob({ gid: G + 52, states: { healthState: 'sleep' } }))
					.advance(16)
			);
			const att = layersOf(lastFrame(r), G + 52).find(l => l.layer === 'attachment');
			expect(att.zIndex === 1 || att.zIndex === 500).toBe(true);
			expect(att.depth.write).toBe(false);
			expect(att.color.slice(0, 3)).toEqual([1, 1, 1]);
		}
	);

	rule(
		'R-SPR-032',
		'STR attachment scale ((xSize+ySize)/2)/5, pivot 320 w/o 0.5 base, offsets ×0.2·35·scale',
		async s => {
			const g = await s.cpu('records.strAttachmentTransform', { xSize: 4, ySize: 4, xOffset: 10, yOffset: 5 });
			expect(g.scale).toBeCloseTo(0.8, 6);
			expect(g.pivot).toEqual([320, 320]);
			expect(g.base).toBe(0);
			expect(g.offset[0]).toBeCloseTo(10 * 0.2 * 35 * 0.8, 6);
		}
	);

	rule('R-SPR-033', 'dropped item: z = max(ground, z0 − t/40)', async s => {
		const r = await run(
			s,
			inGame('spr-033')
				.item({ gid: G + 53, itemid: 501, x: 21, y: 21, z: 10, identify: 1, count: 1 })
				.advance(200, 1)
				.advance(1000, 1)
		);
		const [a, b] = r.frames.map(f => sprites(f, { layer: 'item' })[0].position[1]);
		expect(-a).toBeCloseTo(10 - 200 / 40, 3);
		expect(-b).toBeCloseTo(0, 3);
	});

	rule('R-SPR-034', '2D preview: ≤8 colour variants per (frame,palette); mirror/rotate; Y −17.5 px', async s => {
		const out = await s.cpu('preview2d.render', {
			entity: pc({ gid: G + 54, full: true }),
			colors: 10,
			canvas: { width: 100, height: 100 },
			origin: [50, 80]
		});
		expect(out.cacheVariantsPerFrame).toBeLessThanOrEqual(8);
		expect(out.cellMiddleOffsetY).toBe(-17.5);
	});
});
