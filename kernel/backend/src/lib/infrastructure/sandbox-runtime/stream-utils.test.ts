import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { readSandboxByteLimitedText } from "./stream-utils";

describe("sandbox byte-limited text streams", () => {
	it("assembles chunks and decodes UTF-8 text", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const body = yield* readSandboxByteLimitedText(
					Stream.fromIterable([new Uint8Array([0xf0, 0x9f]), new Uint8Array([0x99, 0x82])]),
					4,
					"oversized",
				);

				expect(body).toBe("🙂");
			}),
		));

	it("fails when accumulated chunks exceed the byte limit", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					readSandboxByteLimitedText(
						Stream.fromIterable([new Uint8Array([1, 2]), new Uint8Array([3])]),
						2,
						"oversized",
					),
				);

				expect(exit._tag).toBe("Failure");
				if (exit._tag === "Failure") {
					expect(String(exit.cause)).toContain("oversized");
				}
			}),
		));
});
