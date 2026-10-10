import type { JsonValue } from "@ryot-app/contract/schema/json";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { encodedJsonBytes } from "./json-bytes";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

describe("encodedJsonBytes", () => {
	it("matches serialized UTF-8 length for escapes, surrogates and nesting", () => {
		const values: ReadonlyArray<JsonValue> = [
			null,
			true,
			false,
			0,
			-0,
			-12.5e-7,
			1e21,
			"",
			'quote " backslash \\ newline \n tab \t bell \u0007 nul \u0000',
			"é€😀 lone \ud800 low \udc00 end",
			"\u0001".repeat(64),
			[],
			[[], [[]], {}],
			{},
			{ "2": 2, "10": 1, ü: false, "key\n": [1, "two", { three: null }] },
		];
		for (const value of values) {
			expect(encodedJsonBytes(value, Number.MAX_SAFE_INTEGER)).toBe(
				utf8ByteLength(encodeJson(value)),
			);
		}
	});

	it("stops counting once the limit is passed", () => {
		const value = ["a".repeat(100), "b".repeat(100)];
		expect(encodedJsonBytes(value, 50)).toBeGreaterThan(50);
		expect(encodedJsonBytes(value, 50)).toBeLessThan(utf8ByteLength(encodeJson(value)));
	});
});
