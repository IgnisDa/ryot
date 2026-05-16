import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { BadRequest } from "./errors";
import { requireText, trimToNull } from "./validation";

describe("trimToNull", () => {
	it("returns null for an empty string", () => {
		expect(trimToNull("")).toBeNull();
	});

	it("returns null for whitespace-only input", () => {
		expect(trimToNull("   ")).toBeNull();
	});

	it("returns the trimmed string for non-blank input", () => {
		expect(trimToNull("  hello  ")).toBe("hello");
	});
});

describe("requireText", () => {
	it.effect("fails with BadRequest for an empty string", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(requireText("", "Value is required"));

			expect(error).toBeInstanceOf(BadRequest);
			expect(error.message).toBe("Value is required");
		}),
	);

	it.effect("fails with BadRequest for whitespace-only input", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(requireText("   ", "Value is required"));

			expect(error).toBeInstanceOf(BadRequest);
			expect(error.message).toBe("Value is required");
		}),
	);

	it.effect("succeeds with the trimmed string for non-blank input", () =>
		Effect.gen(function* () {
			const result = yield* requireText("  hello  ", "Value is required");

			expect(result).toBe("hello");
		}),
	);
});
