import { GL } from '../pipeline/glEnums.js';

/**
 * R-PERF-003: `enableMipmap` adds LINEAR_MIPMAP_LINEAR + generateMipmap for
 * world, ground and damage textures; otherwise LINEAR with no mips.
 * Mip generation has one owner: Residency (architecture §2.2).
 * @param {boolean} enableMipmap
 */
export function worldTextureFilter(enableMipmap) {
	return {
		min: enableMipmap ? GL.LINEAR_MIPMAP_LINEAR : GL.LINEAR,
		mag: GL.LINEAR,
		generateMipmap: Boolean(enableMipmap)
	};
}
