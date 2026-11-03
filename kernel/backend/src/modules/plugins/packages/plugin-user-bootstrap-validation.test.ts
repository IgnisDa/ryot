import { expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Effect, Exit, Option } from "effect";

import { fixtureManifest } from "../test-support";
import { validatePluginExecutableScripts, validatePluginManifestReferences } from "./validation";

const userBootstrapManifest = () => {
	const manifest = fixtureManifest();
	const declared = manifest.scripts[0];
	assert(declared);
	const {
		automationType: _automationType,
		inputProjection: _inputProjection,
		...common
	} = declared;
	const script = {
		...common,
		name: "User bootstrap",
		kind: "script" as const,
		slug: "fixture.user-bootstrap",
	};
	return {
		...manifest,
		scripts: [...manifest.scripts, script],
		userBootstrap: [
			{ slug: "fixture", scriptSlug: script.slug, description: "Bootstrap fixture user data" },
		],
	};
};

it.effect(
	"rejects duplicate, missing, and incompatible user bootstrap script references",
	() => {
		const cases = [
			(manifest: ReturnType<typeof userBootstrapManifest>) => {
				const entry = manifest.userBootstrap[0];
				assert(entry);
				return { ...manifest, userBootstrap: [...manifest.userBootstrap, { ...entry }] };
			},
			(manifest: ReturnType<typeof userBootstrapManifest>) => ({
				...manifest,
				userBootstrap: [
					{
						slug: "fixture",
						scriptSlug: "missing-script",
						description: "Missing fixture bootstrap",
					},
				],
			}),
			(manifest: ReturnType<typeof userBootstrapManifest>) => ({
				...manifest,
				userBootstrap: [
					{
						slug: "fixture",
						scriptSlug: "fixture.automation",
						description: "Incompatible fixture bootstrap",
					},
				],
			}),
		];

		return Effect.forEach(cases, (mutate) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					validatePluginManifestReferences(mutate(userBootstrapManifest())),
				);
				expect(Exit.isFailure(exit)).toBe(true);
			}),
		);
	},
	testTimeout,
);

it.effect(
	"requires a compiled direct script",
	() => {
		const manifest = userBootstrapManifest();
		const entry = manifest.userBootstrap[0];
		assert(entry);
		const normalized = {
			manifest,
			scripts: [{ slug: entry.scriptSlug, metadata: { kind: "automation" as const } }],
		};

		return Effect.gen(function* () {
			const exit = yield* Effect.exit(validatePluginExecutableScripts(normalized));
			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			expect(failure.value._tag).toBe("PluginValidationError");
			expect(failure.value.issues.join("; ")).toContain("must be a direct script");
		});
	},
	testTimeout,
);

const withEntities = (
	...entries: ReadonlyArray<ReadonlyArray<{ name: string; properties: Record<string, string> }>>
) => ({
	...fixtureManifest(),
	userBootstrap: entries.map((entities, index) => ({
		slug: `seed-${index}`,
		description: "Seed fixture entities",
		entities: entities.map((entity) => ({ ...entity, entitySchemaSlug: "fixture-entity" })),
	})),
});

it.effect(
	"accepts declared bootstrap entities and rejects unknown, invalid, or repeated schemas",
	() => {
		const valid = withEntities([{ name: "Fixture", properties: { kind: "one" } }]);
		const rejected = [
			{
				...valid,
				userBootstrap: [
					{
						slug: "seed",
						description: "Unknown schema",
						entities: [{ properties: {}, name: "Missing", entitySchemaSlug: "missing" }],
					},
				],
			},
			withEntities([{ name: "Fixture", properties: { kind: "three" } }]),
			withEntities([{ name: "First", properties: {} }], [{ name: "Second", properties: {} }]),
		];

		return Effect.gen(function* () {
			yield* validatePluginManifestReferences(valid);
			yield* validatePluginExecutableScripts({ scripts: [], manifest: valid });
			for (const manifest of rejected) {
				const exit = yield* Effect.exit(validatePluginManifestReferences(manifest));
				expect(Exit.isFailure(exit)).toBe(true);
			}
		});
	},
	testTimeout,
);
