import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import {
	PluginSurfaceError,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
} from "./validation";

const requireFixtureScript = () => {
	const script = fixtureManifest().scripts[0];
	assert(script);
	return script;
};

const bootManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return {
		...manifest,
		boot: [{ slug: "fixture-boot", scriptSlug: script.slug, description: "Fixture boot" }],
	};
};

it.effect("rejects duplicate boot slugs and unknown scripts", () => {
	const cases = [
		(manifest: ReturnType<typeof bootManifest>) => {
			const boot = manifest.boot[0];
			assert(boot);
			return { ...manifest, boot: [...manifest.boot, { ...boot }] };
		},
		(manifest: ReturnType<typeof bootManifest>) => {
			const boot = manifest.boot[0];
			assert(boot);
			return { ...manifest, boot: [{ ...boot, scriptSlug: "missing-script" }] };
		},
	];
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) => {
		const manifest = mutate(bootManifest());
		return Effect.gen(function* () {
			const exit = yield* Effect.exit(validatePluginManifestReferences(manifest, snapshot));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});

it.effect("applies system and user manifest policy", () =>
	Effect.gen(function* () {
		const script = { ...requireFixtureScript(), slug: "fixture.script", kind: "script" as const };
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
				boot: bootManifest().boot,
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
					boot: bootManifest().boot,
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
			"boot",
			"httpRateLimits",
			"userBootstrap",
		]);
	}),
);
