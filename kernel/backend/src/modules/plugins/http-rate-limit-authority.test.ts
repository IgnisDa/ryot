import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";

import { PluginHttpRateLimitAuthority } from "./http-rate-limit-authority";
import { PluginRepository } from "./repository";

const declarations = (slug: string, key: string, origin: string) => ({
	slug,
	httpRateLimits: [{ key, requests: 5, origins: [origin], intervalMs: 1_000 }],
});

const authorityLayer = (
	listActiveHttpRateLimits: PluginRepository["Service"]["listActiveHttpRateLimits"],
) =>
	PluginHttpRateLimitAuthority.layer.pipe(
		Layer.provide(
			Layer.mergeAll(databaseLayer, Layer.mock(PluginRepository)({ listActiveHttpRateLimits })),
		),
	);

it.effect("resolves matched and unmatched request origins from active database manifests", () =>
	Effect.gen(function* () {
		const authority = yield* PluginHttpRateLimitAuthority;

		expect(yield* authority.resolve("https://API.EXAMPLE.COM:443/path?q=1")).toEqual({
			matched: true,
			origin: "https://api.example.com",
			hash: expect.stringMatching(/^[a-f0-9]{64}$/),
			declaration: {
				requests: 5,
				intervalMs: 1_000,
				key: "catalog.api",
				origins: ["https://api.example.com"],
			},
		});
		expect(yield* authority.resolve("https://other.example.com/path")).toEqual({
			matched: false,
			reason: "undeclared-origin",
			origin: "https://other.example.com",
		});
		expect(yield* authority.resolve("not a url")).toEqual({
			matched: false,
			reason: "invalid-url",
		});
		expect(yield* authority.resolve("file:///tmp/example")).toEqual({
			matched: false,
			reason: "non-http-url",
		});
	}).pipe(
		Effect.provide(
			authorityLayer(() =>
				Effect.succeed([declarations("database", "catalog.api", "https://api.example.com")]),
			),
		),
	),
);

it.effect("propagates database failures instead of returning unmatched", () =>
	Effect.gen(function* () {
		const authority = yield* PluginHttpRateLimitAuthority;
		const exit = yield* Effect.exit(authority.resolve("https://api.example.com"));

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBeInstanceOf(DbError);
		}
	}).pipe(
		Effect.provide(
			authorityLayer(() => Effect.fail(new DbError({ message: "database unavailable" }))),
		),
	),
);
