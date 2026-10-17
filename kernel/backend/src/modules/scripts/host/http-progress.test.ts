import { assert, expect, it } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { Effect, Option, Schema } from "effect";

import { buildHttpRateLimitLookups } from "#modules/plugins/catalog/http-rate-limits";

import { SandboxHttpPolicy, SandboxHttpProgress, ScriptInlineProgress } from "./http-progress";

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

const declaration = { requests: 1, intervalMs: 1_000, key: "catalog.api", hash: "catalog-hash" };
const rateLimit = {
	state: "failure" as const,
	error: {
		message: "HTTP 429" as const,
		data: { body: "slow down", status: 429 as const, headers: { "retry-after": "2" } },
	},
};
const progress = {
	attempt: 1,
	networkAttempt: 2,
	blockWaitAttempt: 1,
	admissionAttempt: 2,
	coordinationAttempt: 1,
	registrationAttempt: 2,
	coordinationBackoffAttempt: 0,
	current: { hop: 1, headers: {}, method: "GET", url: "https://api.example.com/next" },
	cleanup: {
		declaration,
		ticket: {
			tenant: "user",
			plugin: "plugin",
			id: "execution:0:1:1",
			lane: "background" as const,
		},
	},
};

const phases: ReadonlyArray<SandboxHttpProgress["phase"]> = [
	{ rateLimit: null, _tag: "Admitting" },
	{ rateLimit, _tag: "Admitting" },
	{ rateLimit, declaration, delayMs: 2_000, _tag: "ApplyingRateLimitBlock" },
	{ rateLimit, blockedUntilMs: 2_000, _tag: "WaitingForRateLimitBlock" },
];

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
);

it.each([
	{ _tag: "Admitting" },
	{ rateLimit, delayMs: 1, _tag: "ApplyingRateLimitBlock" },
	{ delayMs: 1, declaration, _tag: "ApplyingRateLimitBlock" },
	{ rateLimit, declaration, delayMs: -1, _tag: "ApplyingRateLimitBlock" },
	{ rateLimit, declaration, delayMs: 3_600_001, _tag: "ApplyingRateLimitBlock" },
	{ rateLimit, _tag: "WaitingForRateLimitBlock" },
	{ rateLimit, blockedUntilMs: -1, _tag: "WaitingForRateLimitBlock" },
	{
		blockedUntilMs: 1,
		_tag: "WaitingForRateLimitBlock",
		rateLimit: { value: null, state: "success" },
	},
	{
		blockedUntilMs: 1,
		_tag: "WaitingForRateLimitBlock",
		rateLimit: {
			...rateLimit,
			error: { ...rateLimit.error, data: { ...rateLimit.error.data, status: 500 } },
		},
	},
])("rejects incomplete or contradictory HTTP phase payloads: %j", (phase) => {
	expect(
		Option.isNone(Schema.decodeUnknownOption(SandboxHttpProgress)({ ...progress, phase })),
	).toBe(true);
});

it.each([-1, 6])("rejects a prepared hop outside the redirect budget: %i", (hop) => {
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
