import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { fixtureManifest } from "../test-support";
import { PluginValidationError, validatePluginManifestReferences } from "./validation";

const manifestWithRelationshipProjection = (
	capabilities: ReadonlyArray<"createEvents" | "executeRyotql">,
	fields: Record<string, { label: string; type: "number"; description: string }>,
) => {
	const fixture = fixtureManifest();
	const [script] = fixture.scripts;
	assert(script);
	const { automationType: _automationType, inputProjection: _inputProjection, ...common } = script;
	const processor = {
		...common,
		kind: "script" as const,
		slug: "fixture.projection",
		capabilities: [...capabilities],
	};
	return {
		...fixture,
		scripts: [...fixture.scripts, processor],
		relationshipSchemas: [
			{
				name: "Link",
				slug: "link",
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
				propertiesSchema: {
					fields: { note: { label: "Note", description: "Note", type: "number" as const } },
				},
				projection: {
					scriptSlug: processor.slug,
					propertiesSchema: { fields, unknownKeys: "strict" as const },
				},
			},
		],
	};
};

const issuesOf = (exit: Exit.Exit<unknown, unknown>) => {
	assert(Exit.isFailure(exit));
	const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
	assert(failure instanceof PluginValidationError);
	return failure.issues;
};

it.effect("validates relationship projection processors and output schemas", () =>
	Effect.gen(function* () {
		const score = { label: "Score", description: "Score", type: "number" as const };
		yield* validatePluginManifestReferences(
			manifestWithRelationshipProjection(["executeRyotql"], { score }),
		);
		expect(
			issuesOf(
				yield* Effect.exit(
					validatePluginManifestReferences(
						manifestWithRelationshipProjection(["createEvents"], { score }),
					),
				),
			),
		).toEqual([
			"Relationship projection processor must use only read-only host capabilities and cannot start workflows",
		]);
		expect(
			issuesOf(
				yield* Effect.exit(
					validatePluginManifestReferences(
						manifestWithRelationshipProjection(["executeRyotql"], { note: score }),
					),
				),
			),
		).toEqual([
			"Relationship projection requires a strict, non-empty output schema disjoint from source properties with at most 20 fields",
		]);
	}),
);
