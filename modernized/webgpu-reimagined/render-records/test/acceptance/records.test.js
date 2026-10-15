/**
 * SpriteDraw unit contract: records carry sprite pixels + xSize/ySize (as the
 * legacy SpriteRenderer did); 3D backends convert with spriteToWorld (R-SPR-003).
 */
import { describe, expect, it } from 'vitest';
import { createSpriteDraw, spriteToWorld, SPRITE_DEFAULTS } from '../../src/records/SpriteDraw.js';

describe('R-SPR-003 SpriteDraw units', () => {
	it('R-SPR-003 defaults to xSize = ySize = 5 (35 px per cell)', () => {
		expect([SPRITE_DEFAULTS.xSize, SPRITE_DEFAULTS.ySize]).toEqual([5, 5]);
	});

	it('R-SPR-003 world size = px/175·xSize; offset y −0.5', () => {
		const r = createSpriteDraw({ size: [35, 70], offset: [35, 0] });
		const w = spriteToWorld(r);
		expect(w.size[0]).toBeCloseTo(1);
		expect(w.size[1]).toBeCloseTo(2);
		expect(w.offset[0]).toBeCloseTo(1);
		expect(w.offset[1]).toBeCloseTo(-0.5);
	});

	it('R-SPR-003 baby (4) and warp portal (20) scales', () => {
		expect(spriteToWorld(createSpriteDraw({ size: [175, 175], xSize: 4, ySize: 4 })).size).toEqual([4, 4]);
		expect(spriteToWorld(createSpriteDraw({ size: [175, 175], xSize: 20, ySize: 20 })).size).toEqual([20, 20]);
	});
});
