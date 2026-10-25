import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { isJsonValue, JsonValue } from "./json";

const epoch = new Date(0);

class JsonLike {
	value = "not plain";
}

describe("JsonValue", () => {
	it.effect("accepts canonical values, null-prototype records, and shared references", () =>
		Effect.gen(function* () {
			const shared = { enabled: true };
			const nullPrototype = { value: shared };
			Reflect.setPrototypeOf(nullPrototype, null);
			const value = { left: shared, right: nullPrototype, list: [null, "text", 42, false] };

			expect(isJsonValue(value)).toBe(true);
			expect(yield* Schema.decodeEffect(JsonValue)(value)).toBe(value);
		}),
	);

	it.effect("rejects non-JSON scalar and object values", () =>
		Effect.gen(function* () {
			for (const value of [
				undefined,
				1n,
				Symbol("value"),
				() => undefined,
				Number.NaN,
				Number.POSITIVE_INFINITY,
				epoch,
				new Map(),
				new Set(),
				new Uint8Array(),
				new JsonLike(),
			]) {
				expect(isJsonValue(value)).toBe(false);
				yield* Effect.flip(Schema.decodeUnknownEffect(JsonValue)(value));
			}
		}),
	);

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

	it.effect("rejects direct and indirect cycles without rejecting shared values", () =>
		Effect.gen(function* () {
			const direct: Record<string, unknown> = {};
			direct["self"] = direct;
			const indirect: unknown[] = [];
			indirect.push({ indirect });

			expect(isJsonValue(direct)).toBe(false);
			expect(isJsonValue(indirect)).toBe(false);
			yield* Effect.flip(Schema.decodeUnknownEffect(JsonValue)(direct));
		}),
	);
});
