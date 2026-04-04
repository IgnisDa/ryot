import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { dbRunnerLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { PluginHttpRateLimitAuthority } from "./http-rate-limit-authority";
import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";

const manifest = (slug: string, key: string, origin: string) => {
	const value = fixtureManifest();
	return {
		...value,
		metadata: { ...value.metadata, slug },
		httpRateLimits: [{ key, origins: [origin], requests: 5, intervalMs: 1_000 }],
	};
};

const authorityLayer = (listActiveManifests: PluginRepository["Service"]["listActiveManifests"]) =>
	PluginHttpRateLimitAuthority.layer.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, Layer.mock(PluginRepository)({ listActiveManifests })),
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
				Effect.succeed([manifest("database", "catalog.api", "https://api.example.com")]),
			),
		),
	),
);

it.effect("ignores a stale loader snapshot and resolves only database authority", () => {
	const loaderLayer = Layer.succeed(PluginLoader, makePluginLoader(makeDefinitionRegistry()));
	const layer = Layer.mergeAll(
		loaderLayer,
		authorityLayer(() =>
			Effect.succeed([manifest("database", "database.policy", "https://database.example.com")]),
		),
	);

	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const authority = yield* PluginHttpRateLimitAuthority;
		const stale = manifest("stale", "stale.policy", "https://stale.example.com");
		loader.load({ manifest: stale, scripts: [], sourceHash: "stale-source" });

		expect(yield* authority.resolve("https://stale.example.com/request")).toMatchObject({
			matched: false,
			reason: "undeclared-origin",
		});
		expect(yield* authority.resolve("https://database.example.com/request")).toMatchObject({
			matched: true,
			declaration: { key: "database.policy" },
		});
	}).pipe(Effect.provide(layer));
});

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
