import { PICK } from '../constants.js';
import { create, invert, multiply, transformVec4 } from '../math/mat4.js';

const STRIDE = 5; // 4 corner heights + type per cell (MAP_ALTITUDE payload)

/**
 * Altitude / GAT (R-MAP-023, R-PICK-001). CPU only. Used by 8 non-render modules + EffectTable.
 * Instance-scoped: one per loaded map.
 */
export class Altitude {
	/**
	 * @param {{ cells: Float32Array, width: number, height: number }} payload MAP_ALTITUDE
	 */
	constructor({ cells, width, height }) {
		this.cells = cells;
		this.width = width;
		this.height = height;
		const count = cells.length / STRIDE;
		this.types = new Uint8Array(count);
		for (let i = 0; i < count; i++) {
			this.types[i] = cells[i * STRIDE + 4];
		}
	}

	/** Map-less placeholder: every height is 0. */
	static empty() {
		return new Altitude({ cells: new Float32Array(0), width: 0, height: 0 });
	}

	/** Raw GAT type of a cell (0 outside). */
	getCellType(x, y) {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return 0;
		}
		return this.types[Math.floor(x) + Math.floor(y) * this.width];
	}

	/** Mutate a cell type (pathfinding sync is the caller's job). */
	setCellType(x, y, type) {
		this.types[x + y * this.width] = type;
	}

	/**
	 * Bilinear height at (x+0.5, y+0.5), negated. 0 outside the map (R-MAP-023).
	 */
	getCellHeight(x, y) {
		if (!this.width) {
			return 0;
		}
		x += 0.5;
		y += 0.5;
		const cx = Math.floor(x);
		const cy = Math.floor(y);
		if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) {
			return 0;
		}
		const i = (cx + cy * this.width) * STRIDE;
		const fx = x % 1.0;
		const fy = y % 1.0;
		const c = this.cells;
		const x1 = c[i] + (c[i + 1] - c[i]) * fx;
		const x2 = c[i + 2] + (c[i + 3] - c[i + 2]) * fx;
		return -(x1 + (x2 - x1) * fy);
	}

	/**
	 * Ground ray-march (R-PICK-001): unit steps, ≤200, first in-map sample with
	 * |height + y| < 0.5. Coordinates are scene space (x, y-up, z).
	 * @param {number[]} origin
	 * @param {number[]} unitDir normalised
	 * @returns {[number, number]|null} [x, y] in map cells
	 */
	rayMarch(origin, unitDir) {
		const p = [...origin];
		for (let i = 0; i < PICK.GROUND_RAY_STEPS; i++) {
			p[0] += unitDir[0];
			p[1] += unitDir[1];
			p[2] += unitDir[2];
			if (p[0] < 0 || p[2] < 0 || p[0] >= this.width || p[2] >= this.height) {
				continue;
			}
			if (Math.abs(this.getCellHeight(p[0], p[2]) + p[1]) < PICK.GROUND_RAY_TOLERANCE) {
				return [p[0], p[2]];
			}
		}
		return null;
	}

	/**
	 * Unproject the mouse through the far plane and ray-march.
	 * R-PP-011: when the illusion flip is active the NDC Y is mirrored.
	 * @param {Float32Array} modelView
	 * @param {Float32Array} projection
	 * @param {{x:number,y:number,width:number,height:number}} screen
	 * @param {{ flipped?: boolean }} [opts]
	 */
	intersect(modelView, projection, screen, { flipped = false } = {}) {
		const inv = invert(create(), modelView);
		if (!inv) {
			return null;
		}
		const from = [inv[12], inv[13], inv[14]];
		let ndcY = -(screen.y / screen.height) * 2 + 1;
		if (flipped) {
			ndcY = -ndcY;
		}
		const ndc = [(screen.x / screen.width) * 2 - 1, ndcY, 1, 1];
		const vp = invert(create(), multiply(create(), projection, modelView));
		if (!vp) {
			return null;
		}
		const t = transformVec4(vp, ndc);
		const to = [t[0] / t[3], t[1] / t[3], t[2] / t[3]];
		const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
		const len = Math.hypot(...d) || 1;
		return this.rayMarch(
			from,
			d.map((v) => v / len)
		);
	}
}
