import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { fixtureManifest } from "./test-support";
import { validatePluginExecutableScripts, validatePluginManifestReferences } from "./validation";

const workflowManifest = () => {
	const manifest = fixtureManifest();
	const script = manifest.scripts[0];
	assert(script);
	return {
		...manifest,
		scripts: [
			...manifest.scripts,
			{
				...script,
				name: "Workflow",
				slug: "workflow.fixture",
				kind: "workflow" as const,
				capabilities: [] as const,
			},
		],
		workflows: [{ slug: "refresh.fixture", scriptSlug: "workflow.fixture" }],
	};
};

it.effect("rejects duplicate workflow slugs and non-workflow declarations", () => {
	const cases = [
		(manifest: ReturnType<typeof workflowManifest>) => {
			const workflow = manifest.workflows[0];
			assert(workflow);
			return { ...manifest, workflows: [...manifest.workflows, { ...workflow }] };
		},
		(manifest: ReturnType<typeof workflowManifest>) => ({
			...manifest,
			workflows: [{ slug: "refresh.fixture", scriptSlug: "fixture.automation" }],
		}),
	];
	const snapshot = makeDefinitionRegistry().getSnapshot();

	return Effect.forEach(cases, (mutate) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				validatePluginManifestReferences(mutate(workflowManifest()), snapshot),
			);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

it.effect("requires workflow declarations to reference compiled workflow scripts", () => {
	const manifest = workflowManifest();
	const normalized = {
		manifest,
		scripts: [{ slug: "workflow.fixture", metadata: { kind: "operation" as const } }],
	};

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(validatePluginExecutableScripts(normalized));
		assert(Exit.isFailure(exit));
		const failure = Cause.findErrorOption(exit.cause);
		assert(Option.isSome(failure));
		expect(failure.value._tag).toBe("PluginValidationError");
		expect(failure.value.issues.join("; ")).toContain("must be a workflow script");
	});
});
