import { expect } from "bun:test";

import { fixtureManifest } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Effect, Exit, Option } from "effect";

import { PluginValidationError, validatePluginManifestReferences } from "./validation";

const score = { description: "Score", type: "number" as const, label: { key: "test.score" } };

const manifestWithFold = (input: {
	readonly eventSchemaSlugs?: readonly [string, ...string[]];
	readonly capabilities?: ReadonlyArray<"httpCall" | "executeRyotql">;
	readonly fields?: Record<string, { type: "number"; description: string; label: { key: string } }>;
	readonly entityProperties?: ReadonlyArray<{
		readonly entitySchemaSlug: string;
		readonly properties: readonly [string, ...string[]];
	}>;
}) => {
	const fixture = fixtureManifest();
	const [script] = fixture.scripts;
	const [entity, ...entities] = fixture.entitySchemas;
	assert(script);
	assert(entity);
	const { automationType: _automationType, inputProjection: _inputProjection, ...common } = script;
	const fold = {
		...common,
		slug: "fixture.fold",
		kind: "script" as const,
		capabilities: [...(input.capabilities ?? ["executeRyotql"])],
	};
	return {
		...fixture,
		scripts: [...fixture.scripts, fold],
		entitySchemas: [
			{
				...entity,
				fold: {
					scriptSlug: fold.slug,
					eventSchemaSlugs: input.eventSchemaSlugs ?? ["changed"],
					entityProperties: input.entityProperties ?? [
						{ properties: ["kind"], entitySchemaSlug: entity.slug },
					],
				},
			},
			...entities,
		],
		relationshipSchemas: [
			{
				slug: "link",
				name: { key: "test.link" },
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
				projection: {
					propertiesSchema: { unknownKeys: "strict" as const, fields: input.fields ?? { score } },
				},
				propertiesSchema: {
					fields: {
						note: { description: "Note", type: "number" as const, label: { key: "test.note" } },
					},
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

it.effect(
	"validates entity folds and projection output schemas",
	() =>
		Effect.gen(function* () {
			yield* validatePluginManifestReferences(manifestWithFold({}));
			const issues = (input: Parameters<typeof manifestWithFold>[0]) =>
				Effect.map(
					Effect.exit(validatePluginManifestReferences(manifestWithFold(input))),
					issuesOf,
				);
			expect(yield* issues({ capabilities: ["httpCall"] })).toEqual([
				"Entity fold must use only read-only host capabilities and cannot call other scripts",
			]);
			expect(yield* issues({ eventSchemaSlugs: ["missing"] })).toEqual([
				"Entity fold input schema missing is not declared",
			]);
			expect(
				yield* issues({
					entityProperties: [{ properties: ["kind", "size"], entitySchemaSlug: "fixture-entity" }],
				}),
			).toEqual(["Entity fold reads fixture-entity property size, which is not declared"]);
			expect(
				yield* issues({
					entityProperties: [{ properties: ["kind"], entitySchemaSlug: "missing" }],
				}),
			).toEqual(["Entity fold reads missing property kind, which is not declared"]);
			expect(yield* issues({ fields: { note: score } })).toEqual([
				"Relationship projection requires a strict, non-empty output schema disjoint from source properties with at most 20 fields",
			]);
		}),
	testTimeout,
);
