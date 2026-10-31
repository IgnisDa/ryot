import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { CanonicalBase64 } from "./base64";

it.effect("accepts only canonical padded Base64", () =>
	Effect.gen(function* () {
		expect(yield* Schema.decodeEffect(CanonicalBase64)("AP+AQQ==")).toBe("AP+AQQ==");
		for (const value of ["AP-AQQ==", "Zg", "Zh==", "AA===", "////\n"]) {
			yield* Effect.flip(Schema.decodeEffect(CanonicalBase64)(value));
		}
	}),
);
