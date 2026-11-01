import { expect, it } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { fixtureManifest } from "../test-support";
import {
	decodePluginManifest,
	PluginPackageReservedError,
	PluginSurfaceError,
	validatePluginManifestPolicy,
} from "./validation";

const requireFixtureScript = () => {
	const script = fixtureManifest().scripts[0];
	assert(script);
	return script;
};

it.effect("applies system and user manifest policy", () =>
	Effect.gen(function* () {
		const {
			automationType: _automationType,
			inputProjection: _inputProjection,
			...common
		} = requireFixtureScript();
		const script = { ...common, slug: "fixture.script", kind: "script" as const };
		const allowed = {
			...fixtureManifest(),
			scripts: [...fixtureManifest().scripts, script],
			crons: [
				{
					slug: "hourly",
					description: "Hourly",
					scriptSlug: script.slug,
					schedule: { cron: "0 * * * *" } as const,
				},
			],
		};
		yield* validatePluginManifestPolicy(
			{
				...allowed,
				userBootstrap: [{ slug: "seed", description: "Seed", scriptSlug: script.slug }],
			},
			{ scope: "user", systemPackageIds: new Set() },
		);
		yield* validatePluginManifestPolicy(
			{
				...allowed,
				userBootstrap: [{ slug: "seed", description: "Seed", scriptSlug: script.slug }],
				httpRateLimits: [
					{ requests: 1, key: "outbound", intervalMs: 1_000, origins: ["https://example.com"] },
				],
			},
			{ scope: "system" },
		);

		const rejected = yield* Effect.exit(
			validatePluginManifestPolicy(
				{
					...allowed,
					userBootstrap: [{ slug: "seed", description: "Seed", scriptSlug: script.slug }],
					httpRateLimits: [
						{ requests: 1, key: "outbound", intervalMs: 1_000, origins: ["https://example.com"] },
					],
				},
				{ scope: "user", systemPackageIds: new Set() },
			),
		);
		assert(Exit.isFailure(rejected));
		const failure = Option.getOrThrow(Cause.findErrorOption(rejected.cause));
		assert(failure instanceof PluginSurfaceError);
		expect([...failure.surfaces].sort((left, right) => left.localeCompare(right))).toEqual([
			"httpRateLimits",
		]);
	}),
);

it.effect("reserves OAuth providers for system plugins", () =>
	Effect.gen(function* () {
		const manifest = {
			...fixtureManifest(),
			oauthProviders: [
				{
					slug: "account",
					name: "Account",
					scopes: ["read"],
					pkce: "S256" as const,
					clientIdConfigKey: "clientId",
					clientSecretConfigKey: "clientSecret",
					tokenUrl: "https://accounts.example.test/token",
					tokenEndpointAuth: "client_secret_post" as const,
					authorizeUrl: "https://accounts.example.test/authorize",
				},
			],
		};
		yield* validatePluginManifestPolicy(manifest, { scope: "system" });
		const rejected = yield* Effect.exit(
			validatePluginManifestPolicy(manifest, { scope: "user", systemPackageIds: new Set() }),
		);
		assert(Exit.isFailure(rejected));
		const failure = Option.getOrThrow(Cause.findErrorOption(rejected.cause));
		assert(failure instanceof PluginSurfaceError);
		expect(failure.surfaces).toEqual(["oauthProviders"]);
	}),
);

it.effect("reserves the ryot publisher for bundled plugins", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest(PluginPackageId.make("ryot/community"));
		yield* validatePluginManifestPolicy(manifest, { scope: "system" });
		yield* validatePluginManifestPolicy(
			fixtureManifest(PluginPackageId.make("ryot-labs/community")),
			{ scope: "user", systemPackageIds: new Set() },
		);

		const rejected = yield* Effect.exit(
			validatePluginManifestPolicy(manifest, { scope: "user", systemPackageIds: new Set() }),
		);
		assert(Exit.isFailure(rejected));
		const failure = Option.getOrThrow(Cause.findErrorOption(rejected.cause));
		assert(failure instanceof PluginPackageReservedError);
		expect(failure.packageId).toBe("ryot/community");
	}),
);

it.effect("rejects a manifest whose saved view uses the kernel calendar renderer", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const savedView = {
			sortOrder: 0,
			settings: {},
			slug: "calendar",
			name: "Calendar",
			icon: "calendar",
			dataSources: null,
			renderer: { kind: "kernel", name: "calendar" },
		};
		const exit = yield* Effect.exit(decodePluginManifest({ ...manifest, savedViews: [savedView] }));
		expect(Exit.isFailure(exit)).toBe(true);
		expect(Exit.isSuccess(yield* Effect.exit(decodePluginManifest(manifest)))).toBe(true);
	}),
);
