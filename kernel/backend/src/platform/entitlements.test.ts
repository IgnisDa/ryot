import { expect } from "bun:test";

import { entitlementRequired } from "@ryot-app/contract/schema/entitlement";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Duration, Effect, Layer, Option, Redacted, Ref } from "effect";
import type { HttpClientRequest } from "effect/http";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#testing/effect";

import { EntitlementService } from "./entitlements";

const verificationResponse = (data: { valid: boolean; expiry?: string }) =>
	Promise.resolve(Response.json(data));

class FakeVerifier extends Context.Service<
	FakeVerifier,
	{ readonly requests: Effect.Effect<ReadonlyArray<HttpClientRequest.HttpClientRequest>> }
>()("@ryot-app/kernel-backend/platform/entitlements.test/FakeVerifier") {}

const fakeVerifierLayer = (
	respond: () => Promise<Response>,
	proKey: Option.Option<Redacted.Redacted> = Option.some(Redacted.make("pro-key-value")),
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<HttpClientRequest.HttpClientRequest>>([]);
			const client = HttpClient.make((request) =>
				Effect.gen(function* () {
					yield* Ref.update(requests, (all) => [...all, request]);
					const response = yield* Effect.tryPromise({
						try: respond,
						catch: (cause) =>
							new HttpClientError.HttpClientError({
								reason: new HttpClientError.TransportError({ cause, request }),
							}),
					});
					return HttpClientResponse.fromWeb(request, response);
				}),
			);
			return Layer.merge(
				Layer.succeed(FakeVerifier, { requests: Ref.get(requests) }),
				Layer.effect(EntitlementService, EntitlementService.make).pipe(
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(makeAppConfigLayer({ server: { proKey } })),
				),
			);
		}),
	);

layer(fakeVerifierLayer(() => verificationResponse({ valid: true }), Option.none()))((test) => {
	test.effect(
		"makes no request when the Pro Key is empty",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(false);
				expect(yield* (yield* FakeVerifier).requests).toHaveLength(0);
			}),
		testTimeout,
	);
});

layer(fakeVerifierLayer(() => verificationResponse({ valid: true })))((test) => {
	test.effect(
		"returns true for a valid key",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(true);
				const requests = yield* (yield* FakeVerifier).requests;
				expect(requests.map((request) => request.method)).toEqual(["POST"]);
				expect(requests.map((request) => request.headers["authorization"])).toEqual([
					"Bearer pro-key-value",
				]);
			}),
		testTimeout,
	);
});

layer(fakeVerifierLayer(() => verificationResponse({ valid: false })))((test) => {
	test.effect(
		"returns false when the key is no longer valid",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(false);
				expect(yield* entitlements.current).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"requires only declared entitlements",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				yield* entitlements.require(undefined);
				assertExitFails(
					yield* Effect.exit(entitlements.require("pro")),
					entitlementRequired("pro"),
				);
			}),
		testTimeout,
	);
});

layer(fakeVerifierLayer(() => verificationResponse({ valid: true, expiry: "2999-01-01" })))(
	(test) => {
		test.effect(
			"returns true when expiry is in the future",
			() =>
				Effect.gen(function* () {
					const entitlements = yield* EntitlementService;
					expect(yield* entitlements.has("pro")).toBe(true);
				}),
			testTimeout,
		);
	},
);

layer(fakeVerifierLayer(() => verificationResponse({ valid: true, expiry: "1969-01-01" })))(
	(test) => {
		test.effect(
			"returns false when expiry precedes the verification time",
			() =>
				Effect.gen(function* () {
					const entitlements = yield* EntitlementService;
					expect(yield* entitlements.has("pro")).toBe(false);
				}),
			testTimeout,
		);
	},
);

layer(fakeVerifierLayer(() => verificationResponse({ valid: true, expiry: "whenever" })))(
	(test) => {
		test.effect(
			"returns false when expiry is not a date",
			() =>
				Effect.gen(function* () {
					const entitlements = yield* EntitlementService;
					expect(yield* entitlements.has("pro")).toBe(false);
				}),
			testTimeout,
		);
	},
);

layer(fakeVerifierLayer(() => Promise.reject(new Error("connection refused"))))((test) => {
	test.effect(
		"returns false when the transport rejects",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(false);
			}),
		testTimeout,
	);
});

layer(fakeVerifierLayer(() => verificationResponse({ valid: true })))((test) => {
	test.effect(
		"caches verification so two calls issue exactly one request",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(true);
				expect(yield* entitlements.has("pro")).toBe(true);
				expect(yield* (yield* FakeVerifier).requests).toHaveLength(1);
			}),
		testTimeout,
	);
});

layer(
	fakeVerifierLayer(() => verificationResponse({ valid: true, expiry: "1970-01-01T00:30:00Z" })),
)((test) => {
	test.effect(
		"re-compares an unchanged expiry against the clock once the cache lapses",
		() =>
			Effect.gen(function* () {
				const entitlements = yield* EntitlementService;
				expect(yield* entitlements.has("pro")).toBe(true);
				yield* TestClock.adjust(Duration.hours(1));
				expect(yield* entitlements.has("pro")).toBe(false);
				expect(yield* (yield* FakeVerifier).requests).toHaveLength(2);
			}),
		testTimeout,
	);
});
