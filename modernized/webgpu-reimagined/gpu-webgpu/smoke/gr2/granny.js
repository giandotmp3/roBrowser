/**
 * The `granny-ro-js/wasm` seam of the gr2 parity page (served for that specifier by
 * smoke/vite.config.js). `poseAt` and `ready` are the real granny-ro-js ones; `parseAll`
 * and `parseAnimated` turn a synthetic archive tag (gr2/assets.js) into the synthetic
 * parse result, since the repository has no real .gr2 bytes to decompress.
 */
import { poseAt, ready } from '../../../../../node_modules/granny-ro-js/dist/granny-ro.wasm.esm.js';
import { parsedBank, parsedModel } from './assets.js';

const decode = buffer => JSON.parse(new TextDecoder().decode(buffer));

export function parseAll(buffer) {
	return parsedModel(decode(buffer).model);
}

export function parseAnimated(buffer) {
	const tag = decode(buffer);
	return parsedBank(tag.model, tag.bank);
}

export { poseAt, ready };
