import { BadRequest } from "@ryot/contract/errors";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { requireText, trimToNull } from "./validation";

describe("trimToNull", () => {
	it("returns null for an empty string", () => {
		expect(trimToNull("")).toBeNull();
	});

	it("returns null for a whitespace-only string", () => {
		expect(trimToNull("   ")).toBeNull();
	});

	it("trims and returns the value for a padded string", () => {
		expect(trimToNull("  hello  ")).toBe("hello");
	});

	it("returns the value unchanged for a clean string", () => {
		expect(trimToNull("hello")).toBe("hello");
	});
});

describe("requireText", () => {
	it("succeeds with the trimmed value for a non-empty string", () => {
		const result = Effect.runSync(requireText("  hello  ", "must not be empty"));
		expect(result).toBe("hello");
	});

	it("fails with BadRequest for an empty string", () => {
		const result = Effect.runSync(Effect.result(requireText("", "must not be empty")));
		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			expect(result.failure).toBeInstanceOf(BadRequest);
		}
	});

	it("fails with BadRequest for a whitespace-only string", () => {
		const result = Effect.runSync(Effect.result(requireText("   ", "must not be empty")));
		expect(result._tag).toBe("Failure");
	});

	it("includes the provided message in the error", () => {
		const result = Effect.runSync(Effect.result(requireText("", "title is required")));
		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			expect(result.failure.message).toBe("title is required");
		}
	});
});
