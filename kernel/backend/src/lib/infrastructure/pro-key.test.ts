import { expect, it } from "@effect/vitest";
import { HTTPClient } from "@unkey/api";
import { Duration, Effect, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { ProKeyService } from "./pro-key";

const verifyKeyResponse = (data: { valid: boolean; meta?: Record<string, unknown> }) =>
	new Response(
		JSON.stringify({
			meta: { requestId: "req_test" },
			data: { code: data.valid ? "VALID" : "DISABLED", ...data },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);

const makeFetcher = (respond: () => Response) => {
	const calls: Array<Request> = [];
	const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push(input instanceof Request && init == null ? input : new Request(input, init));
		return Promise.resolve(respond());
	};
	return { calls, fetcher };
};

const makeLayer = (
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	proKey: Option.Option<Redacted.Redacted>,
) =>
	ProKeyService.layerWithHttpClient(new HTTPClient({ fetcher })).pipe(
		Layer.provide(makeAppConfigLayer({ server: { proKey } })),
	);

it.effect("makes no request when the Pro Key is empty", () => {
	const { calls, fetcher } = makeFetcher(() => verifyKeyResponse({ valid: true }));
	return Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(false);
		expect(calls).toHaveLength(0);
	}).pipe(Effect.provide(makeLayer(fetcher, Option.none())));
});

it.effect("returns true for a valid key", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(true);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeFetcher(() => verifyKeyResponse({ valid: true })).fetcher,
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("returns false when the key is no longer valid", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeFetcher(() => verifyKeyResponse({ valid: false })).fetcher,
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("returns true when meta.expiry is in the future", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(true);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeFetcher(() => verifyKeyResponse({ valid: true, meta: { expiry: "2999-01-01" } }))
					.fetcher,
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("returns false when meta.expiry precedes the verification time", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeFetcher(() => verifyKeyResponse({ valid: true, meta: { expiry: "1969-01-01" } }))
					.fetcher,
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("returns false when meta.expiry is not a date", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer(
				makeFetcher(() => verifyKeyResponse({ valid: true, meta: { expiry: "whenever" } })).fetcher,
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("returns false when the transport rejects", () =>
	Effect.gen(function* () {
		const proKey = yield* ProKeyService;
		expect(yield* proKey.isValidated).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer(
				() => Promise.reject(new Error("connection refused")),
				Option.some(Redacted.make("pro-key-value")),
			),
		),
	),
);

it.effect("caches verification so two calls issue exactly one request", () =>
	Effect.gen(function* () {
		const { calls, fetcher } = makeFetcher(() => verifyKeyResponse({ valid: true }));
		const layer = makeLayer(fetcher, Option.some(Redacted.make("pro-key-value")));
		yield* Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(true);
			expect(yield* proKey.isValidated).toBe(true);
		}).pipe(Effect.provide(layer));
		expect(calls).toHaveLength(1);
	}),
);

it.effect("re-compares an unchanged expiry against the clock once the cache lapses", () =>
	Effect.gen(function* () {
		const { calls, fetcher } = makeFetcher(() =>
			verifyKeyResponse({ valid: true, meta: { expiry: "1970-01-01T00:30:00Z" } }),
		);
		const layer = makeLayer(fetcher, Option.some(Redacted.make("pro-key-value")));
		yield* Effect.gen(function* () {
			const proKey = yield* ProKeyService;
			expect(yield* proKey.isValidated).toBe(true);
			yield* TestClock.adjust(Duration.hours(1));
			expect(yield* proKey.isValidated).toBe(false);
		}).pipe(Effect.provide(layer));
		expect(calls).toHaveLength(2);
	}),
);
