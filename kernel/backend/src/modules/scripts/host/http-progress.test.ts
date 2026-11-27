import { expect, test } from "bun:test";

import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Option, Schema } from "effect";

import { buildHttpRateLimitLookups } from "#modules/plugins/catalog/http-rate-limits";

import { SandboxHttpPolicy, SandboxHttpProgress, ScriptInlineProgress } from "./http-progress";
import { httpProgressPhases, rateLimitFailure } from "./http-progress.test-support";

it.effect(
	"round-trips an origin-matched policy through its durable schema",
	() =>
		Effect.gen(function* () {
			const origin = "https://api.example.com";
			const policy = buildHttpRateLimitLookups([
				{
					packageId: "test/catalog",
					owner: definitionOwner("catalog"),
					httpRateLimits: [
						{ requests: 2, intervalMs: 1_000, origins: [origin], key: "catalog.api" },
					],
				},
			]).byOrigin[origin];
			assert(policy);
			const durable = { ...policy, origin, durationMs: 0, matched: true as const };

			const encoded = yield* Schema.encodeEffect(SandboxHttpPolicy)(durable);

			expect(yield* Schema.decodeEffect(SandboxHttpPolicy)(encoded)).toEqual(durable);
		}),
	testTimeout,
);

const declaration = { requests: 1, intervalMs: 1_000, key: "catalog.api" };
const progress = {
	attempt: 1,
	networkAttempt: 2,
	admissionAttempt: 2,
	coordinationAttempt: 1,
	coordinationBackoffAttempt: 0,
	current: { hop: 1, headers: {}, method: "GET", url: "https://api.example.com/next" },
};

const phases = httpProgressPhases(declaration);

it.effect.each(phases)(
	"retains the prepared hop and required $_tag phase data through the inline boundary",
	(phase) =>
		Effect.gen(function* () {
			const entry: ScriptInlineProgress = {
				_tag: "Http",
				progress: { ...progress, phase },
				request: {
					index: 0,
					kind: "host",
					name: "httpCall",
					args: { capability: "httpCall", args: ["POST", "https://api.example.com/start"] },
				},
			};
			const boundary = Schema.fromJsonString(ScriptInlineProgress);
			const encoded = yield* Schema.encodeEffect(boundary)(entry);
			expect(yield* Schema.decodeEffect(boundary)(encoded)).toEqual(entry);
		}),
	testTimeout,
);

test.each([
	{ _tag: "Admitting" },
	{ delayMs: 1, rateLimit: rateLimitFailure, _tag: "ApplyingRateLimitBlock" },
	{ delayMs: 1, declaration, _tag: "ApplyingRateLimitBlock" },
	{ declaration, delayMs: -1, rateLimit: rateLimitFailure, _tag: "ApplyingRateLimitBlock" },
	{ declaration, delayMs: 3_600_001, rateLimit: rateLimitFailure, _tag: "ApplyingRateLimitBlock" },
	{ _tag: "Admitting", rateLimit: { value: null, state: "success" } },
	{ slotAtMs: 1.5, rateLimit: null, _tag: "Admitting" },
	{
		_tag: "Admitting",
		rateLimit: {
			...rateLimitFailure,
			error: { ...rateLimitFailure.error, data: { ...rateLimitFailure.error.data, status: 500 } },
		},
	},
])("rejects incomplete or contradictory HTTP phase payloads: %j", (phase) => {
	expect(
		Option.isNone(Schema.decodeUnknownOption(SandboxHttpProgress)({ ...progress, phase })),
	).toBe(true);
});

test.each([-1, 6])("rejects a prepared hop outside the redirect budget: %i", (hop) => {
	expect(
		Option.isNone(
			Schema.decodeOption(SandboxHttpProgress)({
				...progress,
				current: { ...progress.current, hop },
				phase: { rateLimit: null, _tag: "Admitting" },
			}),
		),
	).toBe(true);
});
