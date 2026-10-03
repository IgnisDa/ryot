import { expect, layer } from "@effect/vitest";
import { HTTPClient } from "@unkey/api";
import { Context, Duration, Effect, Layer, MutableRef, Option, Redacted, Ref } from "effect";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { ProKeyService } from "./pro-key";

const verifyKeyResponse = (data: { valid: boolean; meta?: Record<string, unknown> }) =>
	Promise.resolve(
		new Response(
			JSON.stringify({
				meta: { requestId: "req_test" },
				data: { code: data.valid ? "VALID" : "DISABLED", ...data },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
	);

class FakeUnkey extends Context.Service<
	FakeUnkey,
	{ readonly requests: Effect.Effect<ReadonlyArray<Request>> }
>()("test/FakeUnkey") {}

const fakeUnkeyLayer = (
	respond: () => Promise<Response>,
	proKey: Option.Option<Redacted.Redacted> = Option.some(Redacted.make("pro-key-value")),
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const requests = yield* Ref.make<ReadonlyArray<Request>>([]);
			const fetcher = (input: Request | string | URL, init?: RequestInit) => {
				let request: Request;
				if (input instanceof Request) {
					request = init == null ? input : new Request(input, init);
				} else {
					request = new Request(input.toString(), init);
				}
				MutableRef.update(requests.ref, (all) => [...all, request]);
				return respond();
			};
			return Layer.merge(
				Layer.succeed(FakeUnkey, { requests: Ref.get(requests) }),
				ProKeyService.layerWithHttpClient(new HTTPClient({ fetcher })).pipe(
					Layer.provide(makeAppConfigLayer({ server: { proKey } })),
				),
			);
		}),
	);

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true }), Option.none()))((test) => {
	test.effect("makes no request when the Pro Key is empty", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(false);
			expect(yield* (yield* FakeUnkey).requests).toHaveLength(0);
		}),
	);
});

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true })))((test) => {
	test.effect("returns true for a valid key", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(true);
		}),
	);
});

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: false })))((test) => {
	test.effect("returns false when the key is no longer valid", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(false);
		}),
	);
});

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true, meta: { expiry: "2999-01-01" } })))(
	(test) => {
		test.effect("returns true when meta.expiry is in the future", () =>
			Effect.gen(function* () {
				const proKey = yield* ProKeyService;
				expect(yield* proKey.isValidated).toBe(true);
			}),
		);
	},
);

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true, meta: { expiry: "1969-01-01" } })))(
	(test) => {
		test.effect("returns false when meta.expiry precedes the verification time", () =>
			Effect.gen(function* () {
				const proKey = yield* ProKeyService;
				expect(yield* proKey.isValidated).toBe(false);
			}),
		);
	},
);

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true, meta: { expiry: "whenever" } })))(
	(test) => {
		test.effect("returns false when meta.expiry is not a date", () =>
			Effect.gen(function* () {
				const proKey = yield* ProKeyService;
				expect(yield* proKey.isValidated).toBe(false);
			}),
		);
	},
);

layer(fakeUnkeyLayer(() => Promise.reject(new Error("connection refused"))))((test) => {
	test.effect("returns false when the transport rejects", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(false);
		}),
	);
});

layer(fakeUnkeyLayer(() => verifyKeyResponse({ valid: true })))((test) => {
	test.effect("caches verification so two calls issue exactly one request", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(true);
			expect(yield* proKey.isValidated).toBe(true);
			expect(yield* (yield* FakeUnkey).requests).toHaveLength(1);
		}),
	);
});

layer(
	fakeUnkeyLayer(() =>
		verifyKeyResponse({ valid: true, meta: { expiry: "1970-01-01T00:30:00Z" } }),
	),
)((test) => {
	test.effect("re-compares an unchanged expiry against the clock once the cache lapses", () =>
		Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(true);
			yield* TestClock.adjust(Duration.hours(1));
			expect(yield* proKey.isValidated).toBe(false);
			expect(yield* (yield* FakeUnkey).requests).toHaveLength(2);
		}),
	);
});
