import { expect, it } from "@effect/vitest";
import { beforeCreateTriggerResultSchema } from "@ryot/sandbox-sdk/trigger";
import { Effect } from "effect";

import { decodeBeforeTriggerResult } from "./event-creation";

it.effect("keeps the Effect decoder in parity with SDK before-create results", () =>
	Effect.gen(function* () {
		const results = [
			beforeCreateTriggerResultSchema.parse({ action: "allow" }),
			beforeCreateTriggerResultSchema.parse({ action: "skip", reason: "filtered" }),
			beforeCreateTriggerResultSchema.parse({
				action: "replace",
				body: {
					sessionEntityId: null,
					properties: { progressPercent: 100 },
					occurredAt: "2026-01-01T00:00:00.000Z",
				},
			}),
		];

		for (const result of results) {
			expect(yield* decodeBeforeTriggerResult(result)).toEqual(result);
		}

		const malformed = { action: "skip" };
		expect(beforeCreateTriggerResultSchema.safeParse(malformed).success).toBe(false);
		expect((yield* Effect.exit(decodeBeforeTriggerResult(malformed)))._tag).toBe("Failure");
	}),
);
