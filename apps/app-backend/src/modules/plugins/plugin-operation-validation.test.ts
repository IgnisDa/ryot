import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import { validatePluginExecutableScripts, validatePluginManifestReferences } from "./validation";

const operationManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return {
		...manifest,
		scripts: [
			...manifest.scripts,
			{ ...script, kind: "operation" as const, name: "Operation", slug: "operation.fixture" },
		],
		operations: [
			{
				auth: "user" as const,
				slug: "resolve.fixture",
				scriptSlug: "operation.fixture",
				description: "Resolve fixture references",
			},
		],
	};
};

it.effect("rejects duplicate operation slugs and unknown driver references", () => {
	const cases = [
		(manifest: ReturnType<typeof operationManifest>) => {
			const operation = manifest.operations[0];
			assert(operation);
			return { ...manifest, operations: [...manifest.operations, { ...operation }] };
		},
		(manifest: ReturnType<typeof operationManifest>) => {
			const operation = manifest.operations[0];
			assert(operation);
			return { ...manifest, operations: [{ ...operation, scriptSlug: "missing-script" }] };
		},
	];
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) => {
		const manifest = mutate(operationManifest());
		return Effect.gen(function* () {
			const exit = yield* Effect.exit(validatePluginManifestReferences(manifest, snapshot));
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});
});

it.effect("requires operation declarations to reference operation scripts", () => {
	const manifest = operationManifest();
	const normalized = {
		manifest,
		scripts: [
			{
				slug: "operation.fixture",
				metadata: { kind: "automation" as const },
			},
		],
	};

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(validatePluginExecutableScripts(normalized));
		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(exit)).toContain("must be an operation script");
	});
});
