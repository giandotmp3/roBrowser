import { describe, it, expect } from 'vitest';
import { Altitude } from '../../src/domain/Altitude.js';

// 2x1 map: cell0 corners (0, 2, 4, 6), cell1 flat 10
const alt = () =>
	new Altitude({
		cells: new Float32Array([0, 2, 4, 6, 1, 10, 10, 10, 10, 0]),
		width: 2,
		height: 1
	});

describe('R-MAP-023 cell height interpolation', () => {
	it('[R-MAP-023] bilinear over the four corners at (x+0.5, y+0.5), negated', () => {
		// x=0,y=0 -> sample (0.5,0.5): x1 = 0+(2-0)*.5 = 1, x2 = 4+(6-4)*.5 = 5, h = 1+(5-1)*.5 = 3
		expect(alt().getCellHeight(0, 0)).toBeCloseTo(-3, 6);
		// x=0.4 -> 0.9 frac
		expect(alt().getCellHeight(0.4, 0)).toBeCloseTo(-(1.8 + (5.8 - 1.8) * 0.5), 6);
		expect(alt().getCellHeight(1, 0)).toBeCloseTo(-10, 6);
	});

	it('[R-MAP-023] positions outside the map return 0', () => {
		expect(alt().getCellHeight(-1, 0)).toBe(0);
		expect(alt().getCellHeight(2, 0)).toBe(0);
		expect(alt().getCellHeight(0, 5)).toBe(0);
		expect(Altitude.empty().getCellHeight(0, 0)).toBe(0);
	});

	it('[R-MAP-023] cell types are extracted from the 5th float and are mutable', () => {
		const a = alt();
		expect(a.getCellType(0, 0)).toBe(1);
		expect(a.getCellType(1, 0)).toBe(0);
		a.setCellType(1, 0, 5);
		expect(a.getCellType(1, 0)).toBe(5);
	});
});
