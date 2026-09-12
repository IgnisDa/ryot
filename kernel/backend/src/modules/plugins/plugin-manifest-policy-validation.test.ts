import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { fixtureManifest } from "./test-support";
import { PluginSurfaceError, validatePluginManifestPolicy } from "./validation";

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
		yield* validatePluginManifestPolicy(allowed, { scope: "user", systemSlugs: new Set() });
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
				{ scope: "user", systemSlugs: new Set() },
			),
		);
		assert(Exit.isFailure(rejected));
		const failure = Option.getOrThrow(Cause.findErrorOption(rejected.cause));
		assert(failure instanceof PluginSurfaceError);
		expect([...failure.surfaces].sort((left, right) => left.localeCompare(right))).toEqual([
			"httpRateLimits",
			"userBootstrap",
		]);
	}),
);
