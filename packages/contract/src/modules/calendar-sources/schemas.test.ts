import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { SetCalendarSourceVisibilityBody } from "./schemas";

describe("calendar source visibility body", () => {
	it.effect("accepts exact plugin source identities and rejects extra properties", () =>
		Effect.gen(function* () {
			const decode = Schema.decodeUnknownEffect(SetCalendarSourceVisibilityBody);
			expect(yield* decode({ slug: "dates", isHidden: true, pluginId: "plugin-1" })).toEqual({
				slug: "dates",
				isHidden: true,
				pluginId: "plugin-1",
			});
			yield* Effect.flip(
				decode({ slug: "dates", isHidden: true, userId: "other", pluginId: "plugin-1" }),
			);
			yield* Effect.flip(decode({ slug: "dates", pluginId: "plugin-1" }));
		}),
	);
});
