import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import { validatePluginExecutableScripts, validatePluginManifestReferences } from "./validation";

const userBootstrapManifest = () => {
	const manifest = fixtureManifest();
	const declared = manifest.scripts[0];
	assert(declared);
	const script = {
		...declared,
		name: "User bootstrap",
		kind: "script" as const,
		slug: "fixture.user-bootstrap",
	};
	return {
		...manifest,
		scripts: [...manifest.scripts, script],
		userBootstrap: [
			{
				slug: "fixture",
				scriptSlug: script.slug,
				description: "Bootstrap fixture user data",
			},
		],
	};
};

it.effect("rejects duplicate, missing, and incompatible user bootstrap script references", () => {
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
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				validatePluginManifestReferences(mutate(userBootstrapManifest()), snapshot),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

it.effect("requires a compiled direct script", () => {
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
});
