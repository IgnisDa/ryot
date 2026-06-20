import { describe, expect, it } from "bun:test";

import { stableStringify } from "./json";

describe("stableStringify", () => {
	it("sorts object keys regardless of insertion order", () => {
		expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
		expect(stableStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
	});

	it("sorts keys recursively in nested objects", () => {
		expect(stableStringify({ z: { d: 4, c: 3 }, a: 1 })).toBe('{"a":1,"z":{"c":3,"d":4}}');
	});

	it("preserves array element order by default", () => {
		expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
	});

	it("sorts array elements when sortArrays is true", () => {
		expect(stableStringify([3, 1, 2], { sortArrays: true })).toBe("[1,2,3]");
	});

	it("treats a top-level undefined value as null", () => {
		expect(stableStringify(undefined)).toBe("null");
	});

	it("omits object keys whose value is explicitly undefined", () => {
		// JSON.stringify (and therefore any JSONB round-trip through Postgres)
		// drops undefined-valued keys entirely, so stableStringify must agree:
		// otherwise a freshly-built object and the same object read back from
		// storage never compare equal.
		expect(stableStringify({ a: 1, rules: undefined })).toBe(stableStringify({ a: 1 }));
	});

	it("matches a value round-tripped through JSON storage", () => {
		const fresh = { fields: { id: "string" }, rules: undefined, unknownKeys: "strict" };
		const roundTripped = JSON.parse(JSON.stringify(fresh));

		expect(stableStringify(fresh)).toBe(stableStringify(roundTripped));
	});

	it("still distinguishes an explicit null from a missing key", () => {
		expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
	});
});
