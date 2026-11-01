import { expect, it } from "@effect/vitest";
import type { PluginEventProjection } from "@ryot-app/contract/modules/plugins/manifest";
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

it.effect(
	"rejects event projection dependencies that cannot be invalidated through declared source references",
	() =>
		Effect.gen(function* () {
			const fixture = manifestWithRelationshipProjection(["executeRyotql"], {
				score: { label: "Score", type: "number", description: "Score" },
			});
			const entity = fixture.entitySchemas[0];
			const projection = fixture.relationshipSchemas[0]?.projection;
			assert(entity);
			assert(projection);
			const withInputs = (inputs: PluginEventProjection["inputs"]) => ({
				...fixture,
				entitySchemas: [
					{
						...entity,
						eventSchemas: [
							...entity.eventSchemas,
							{
								name: "Projected",
								slug: "projected",
								propertiesSchema: { fields: {} },
								projection: { ...projection, inputs },
							},
							{
								name: "Source",
								slug: "source",
								propertiesSchema: {
									fields: {
										note: { label: "Note", description: "Note", type: "string" as const },
										subject: {
											label: "Subject",
											description: "Subject",
											type: "string" as const,
											reference: { kind: "entity-id" as const },
										},
									},
								},
							},
						],
					},
					...fixture.entitySchemas.slice(1),
				],
			});
			yield* validatePluginManifestReferences(
				withInputs([
					{ scope: "entity", eventSchemaSlug: "projected" },
					{ eventSchemaSlug: "source", scope: { property: "subject" } },
				]),
			);
			expect(
				issuesOf(
					yield* Effect.exit(
						validatePluginManifestReferences(
							withInputs([
								{ scope: "entity", eventSchemaSlug: "projected" },
								{ scope: "entity", eventSchemaSlug: "projected" },
							]),
						),
					),
				),
			).toEqual(["Event projection input paths must be unique"]);
			expect(
				issuesOf(
					yield* Effect.exit(
						validatePluginManifestReferences(
							withInputs([
								{ scope: "entity", eventSchemaSlug: "projected" },
								{ eventSchemaSlug: "source", scope: { property: "note" } },
							]),
						),
					),
				),
			).toEqual(["Event projection input scope note must be a declared entity reference"]);
			expect(
				issuesOf(
					yield* Effect.exit(
						validatePluginManifestReferences(
							withInputs([
								{ scope: "entity", eventSchemaSlug: "projected" },
								{ scope: "entity", eventSchemaSlug: "missing" },
							]),
						),
					),
				),
			).toEqual(["Event projection input schema missing is not declared"]);
		}),
);
