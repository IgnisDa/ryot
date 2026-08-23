import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { isJsonValue, JsonValue } from "./json";

class JsonLike {
	value = "not plain";
}

describe("JsonValue", () => {
	it("accepts canonical values, null-prototype records, and shared references", () => {
		const shared = { enabled: true };
		const nullPrototype = Object.assign(Object.create(null), { value: shared });
		const value = { left: shared, right: nullPrototype, list: [null, "text", 42, false] };

		expect(isJsonValue(value)).toBe(true);
		expect(Schema.decodeUnknownSync(JsonValue)(value)).toBe(value);
	});

	it("rejects non-JSON scalar and object values", () => {
		for (const value of [
			undefined,
			1n,
			Symbol("value"),
			() => undefined,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			new Date(0),
			new Map(),
			new Set(),
			new Uint8Array(),
			new JsonLike(),
		]) {
			expect(isJsonValue(value)).toBe(false);
			expect(() => Schema.decodeUnknownSync(JsonValue)(value)).toThrow();
		}
	});

	it("rejects symbol keys, sparse arrays, custom array properties, and accessors", () => {
		const symbolKeyed = { value: true, [Symbol("hidden")]: false };
		const sparse = Array(2);
		sparse[1] = true;
		const extended = [true] as unknown[] & { extra?: boolean };
		extended.extra = true;
		let accessorRead = false;
		const accessor = Object.defineProperty({}, "value", {
			enumerable: true,
			get: () => {
				accessorRead = true;
				return true;
			},
		});
		const arrayAccessor = Object.defineProperty([], "0", {
			enumerable: true,
			get: () => {
				accessorRead = true;
				return true;
			},
		});

		for (const value of [symbolKeyed, sparse, extended, accessor, arrayAccessor]) {
			expect(isJsonValue(value)).toBe(false);
		}
		expect(accessorRead).toBe(false);
	});

	it("rejects direct and indirect cycles without rejecting shared values", () => {
		const direct: Record<string, unknown> = {};
		direct["self"] = direct;
		const indirect: unknown[] = [];
		indirect.push({ indirect });

		expect(isJsonValue(direct)).toBe(false);
		expect(isJsonValue(indirect)).toBe(false);
		expect(() => Schema.decodeUnknownSync(JsonValue)(direct)).toThrow();
	});
});
