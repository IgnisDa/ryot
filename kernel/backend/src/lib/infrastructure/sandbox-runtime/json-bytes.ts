import type { JsonValue } from "@ryot-app/contract/schema/json";

// Upper bound on decoded JavaScript memory per JSON byte across a whole decode path, measured by
// `json_graph_factor_bounds_pathological_decode_paths`.
export const SANDBOX_JSON_GRAPH_FACTOR = 27;

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const quotedStringBytes = (text: string) => {
	let bytes = 2;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (
			code === 0x22 ||
			code === 0x5c ||
			code === 0x08 ||
			code === 0x09 ||
			code === 0x0a ||
			code === 0x0c ||
			code === 0x0d
		) {
			bytes += 2;
		} else if (code < 0x20) {
			bytes += 6;
		} else if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else {
				bytes += 6;
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			bytes += 6;
		} else {
			bytes += 3;
		}
	}
	return bytes;
};

/**
 * UTF-8 length of the value's JSON text, counted without serializing it so oversized values are
 * rejected before a copy exists. Counting stops once it passes `limit`.
 */
export const encodedJsonBytes = (value: JsonValue, limit: number) => {
	let total = 0;
	const add = (bytes: number) => {
		total += bytes;
		return total <= limit;
	};
	const visit = (current: JsonValue): boolean => {
		if (current === null) {
			return add(4);
		}
		if (typeof current === "boolean") {
			return add(current ? 4 : 5);
		}
		if (typeof current === "number") {
			return add(Object.is(current, -0) ? 1 : String(current).length);
		}
		if (typeof current === "string") {
			return add(quotedStringBytes(current));
		}
		if (isJsonArray(current)) {
			return add(Math.max(2, current.length + 1)) && current.every(visit);
		}
		const keys = Object.keys(current);
		return (
			add(Math.max(2, 2 * keys.length + 1)) &&
			keys.every((key) => {
				const entry = current[key];
				return entry !== undefined && add(quotedStringBytes(key)) && visit(entry);
			})
		);
	};
	visit(value);
	return total;
};
