import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Cause, Effect, Exit, Option } from "effect";
import { assert } from "vitest";

import { SchemaEvolutionError, validateAdditiveSchemaEvolution } from "./schema-evolution";
import { fixtureManifest } from "./test-support";

const entityWithFields = (
	manifest: PluginManifest,
	fields: PluginManifest["entitySchemas"][number]["propertiesSchema"]["fields"],
) => {
	const entity = manifest.entitySchemas[0];
	assert(entity);
	return { ...entity, propertiesSchema: { ...entity.propertiesSchema, fields } };
};

const evolve = (next: (previous: PluginManifest) => PluginManifest) => {
	const previous = fixtureManifest();
	return Effect.runSyncExit(validateAdditiveSchemaEvolution(previous, next(previous)));
};

it("accepts new schemas, optional properties, and widened enums", () => {
	const exit = evolve((previous) => {
		const entity = previous.entitySchemas[0];
		assert(entity);
		const kind = entity.propertiesSchema.fields["kind"];
		assert(kind?.type === "enum");
		assert(kind.choices.kind === "static");
		return {
			...previous,
			entitySchemas: [
				entityWithFields(previous, {
					...entity.propertiesSchema.fields,
					optional: { type: "string", label: "Optional", description: "Optional value" },
					kind: {
						...kind,
						choices: { kind: "static", values: [...kind.choices.values, { value: "three" }] },
					},
				}),
			],
			signalSchemas: [
				...previous.signalSchemas,
				{
					name: "Added",
					slug: "fixture.added",
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationScriptSlug: "fixture.automation",
				},
			],
		};
	});
	expect(Exit.isSuccess(exit)).toBe(true);
});

it("rejects a changed dynamic choice source", () => {
	const initial = fixtureManifest();
	const initialEntity = initial.entitySchemas[0];
	assert(initialEntity);
	const initialKind = initialEntity.propertiesSchema.fields["kind"];
	const previous: PluginManifest = {
		...initial,
		entitySchemas: [
			entityWithFields(initial, {
				...initialEntity.propertiesSchema.fields,
				kind: { ...initialKind, choices: { kind: "dynamic", source: "statuses-v1" } },
			}),
		],
	};
	const nextEntity = previous.entitySchemas[0];
	assert(nextEntity);
	const nextKind = nextEntity.propertiesSchema.fields["kind"];
	assert(nextKind?.type === "enum");
	const next: PluginManifest = {
		...previous,
		entitySchemas: [
			entityWithFields(previous, {
				...nextEntity.propertiesSchema.fields,
				kind: { ...nextKind, choices: { kind: "dynamic", source: "statuses-v2" } },
			}),
		],
	};

	const exit = Effect.runSyncExit(validateAdditiveSchemaEvolution(previous, next));
	expect(Exit.isFailure(exit)).toBe(true);
	if (Exit.isFailure(exit)) {
		const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
		assert(error instanceof SchemaEvolutionError);
		expect(error.issues).toContainEqual({
			code: "enum_narrowed",
			path: "entity:fixture-entity.kind",
		});
	}
});

it.each([
	{
		code: "schema_removed",
		next: (previous: PluginManifest): PluginManifest => ({ ...previous, signalSchemas: [] }),
	},
	{
		code: "property_removed",
		next: (previous: PluginManifest): PluginManifest => {
			const entity = previous.entitySchemas[0];
			assert(entity);
			const { name: _name, ...fields } = entity.propertiesSchema.fields;
			return { ...previous, entitySchemas: [entityWithFields(previous, fields)] };
		},
	},
	{
		code: "property_type_changed",
		next: (previous: PluginManifest): PluginManifest => {
			const entity = previous.entitySchemas[0];
			assert(entity);
			return {
				...previous,
				entitySchemas: [
					entityWithFields(previous, {
						...entity.propertiesSchema.fields,
						name: { type: "number", label: "Name", description: "Fixture name" },
					}),
				],
			};
		},
	},
	{
		code: "required_property_added",
		next: (previous: PluginManifest): PluginManifest => {
			const entity = previous.entitySchemas[0];
			assert(entity);
			return {
				...previous,
				entitySchemas: [
					entityWithFields(previous, {
						...entity.propertiesSchema.fields,
						required: {
							type: "string",
							label: "Required",
							description: "Required value",
							validation: { required: true },
						},
					}),
				],
			};
		},
	},
	{
		code: "enum_narrowed",
		next: (previous: PluginManifest): PluginManifest => {
			const entity = previous.entitySchemas[0];
			assert(entity);
			const kind = entity.propertiesSchema.fields["kind"];
			assert(kind?.type === "enum");
			assert(kind.choices.kind === "static");
			return {
				...previous,
				entitySchemas: [
					entityWithFields(previous, {
						...entity.propertiesSchema.fields,
						kind: { ...kind, choices: { kind: "static", values: kind.choices.values.slice(0, 1) } },
					}),
				],
			};
		},
	},
	{
		code: "enum_narrowed",
		next: (previous: PluginManifest): PluginManifest => {
			const entity = previous.entitySchemas[0];
			assert(entity);
			const kind = entity.propertiesSchema.fields["kind"];
			assert(kind?.type === "enum");
			return {
				...previous,
				entitySchemas: [
					entityWithFields(previous, {
						...entity.propertiesSchema.fields,
						kind: { ...kind, choices: { kind: "dynamic", source: "other-source" } },
					}),
				],
			};
		},
	},
])("rejects $code with a structured issue", ({ code, next }) => {
	const exit = evolve(next);
	expect(Exit.isFailure(exit)).toBe(true);
	if (Exit.isFailure(exit)) {
		const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
		assert(error instanceof SchemaEvolutionError);
		expect(error.issues.some((issue) => issue.code === code)).toBe(true);
	}
});
