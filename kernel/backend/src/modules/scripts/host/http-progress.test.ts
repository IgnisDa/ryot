import { assert, expect, it } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { Effect, Schema } from "effect";

import { buildHttpRateLimitLookups } from "#modules/plugins/http-rate-limits";

import { SandboxHttpPolicy } from "./http-progress";

it.effect("round-trips an origin-matched policy through its durable schema", () =>
	Effect.gen(function* () {
		const origin = "https://api.example.com";
		const policy = buildHttpRateLimitLookups([
			{
				packageId: "test/catalog",
				owner: definitionOwner("catalog"),
				httpRateLimits: [{ requests: 2, intervalMs: 1_000, origins: [origin], key: "catalog.api" }],
			},
		]).byOrigin[origin];
		assert(policy);
		const durable = { ...policy, origin, durationMs: 0, matched: true as const };

		const encoded = yield* Schema.encodeEffect(SandboxHttpPolicy)(durable);

		expect(yield* Schema.decodeEffect(SandboxHttpPolicy)(encoded)).toEqual(durable);
	}),
);
