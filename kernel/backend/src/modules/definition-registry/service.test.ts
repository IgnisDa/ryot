import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { fixtureManifest } from "#modules/plugins/test-support";

import { kernelDefinitionSource } from "./kernel-source";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSource,
	makeDefinitionRegistry,
} from "./service";

const pluginDefinitionSource = (): DefinitionSource => {
	const kernel = kernelDefinitionSource();
	const base = fixtureManifest();
	const savedView = kernel.savedViews[0];
	assert(savedView);
	const entitySchema = base.entitySchemas[0];
	assert(entitySchema);
	const plugins: ReadonlyArray<PluginManifest> = [
		{
			...base,
			savedViews: [
				{
					...savedView,
					slug: "fixture-items",
					name: "Fixture Items",
					pluginSlug: "fixture",
					entitySchemaSlug: EntitySchemaSlug.make("fixture-entity"),
				},
			],
			entitySchemas: [
				{
					...entitySchema,
					userState: { deniedOperations: ["clear", "merge"] },
					eventSchemas: entitySchema.eventSchemas.map((event) =>
						Object.assign(event, {
							propertiesSchema: {
								fields: {
									value: {
										type: "string",
										label: "Value",
										description: "Changed value",
										validation: { required: true },
									},
								},
							} as const,
						}),
					),
				},
			],
		},
	];
	return {
		savedViews: [...kernel.savedViews, ...plugins.flatMap(({ savedViews }) => savedViews)],
		signalSchemas: [
			...kernel.signalSchemas,
			...plugins.flatMap(({ signalSchemas }) => signalSchemas),
		],
		relationshipSchemas: [
			...kernel.relationshipSchemas,
			...plugins.flatMap(({ relationshipSchemas }) => relationshipSchemas),
		],
		entitySchemas: [
			...kernel.entitySchemas,
			...plugins.flatMap(({ entitySchemas, metadata }) =>
				entitySchemas.map((definition) => ({ ...definition, pluginSlug: metadata.slug })),
			),
		],
	};
};

describe("definition registry", () => {
	it("serves every builtin definition kind from an immutable snapshot", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());
		const snapshot = registry.getSnapshot();

		expect(registry.getEntitySchema("fixture-entity")?.eventSchemas["changed"]?.name).toBe(
			"Changed",
		);
		expect(registry.getRelationshipSchema("fixture-link")?.name).toBe("Fixture Link");
		expect(registry.getSignalSchema("fixture.signal")?.name).toBe("Fixture Signal");
		expect(registry.getSignalSchema("fixture.signal")?.notificationScriptSlug).toBe(
			"fixture.automation",
		);
		expect(registry.getEntitySchema("collection")?.pluginSlug).toBeNull();
		expect(registry.getEntitySchema("fixture-entity")?.pluginSlug).toBe("fixture");
		expect(registry.getSavedView("collections")?.pluginSlug).toBeNull();
		expect(registry.getSavedView("fixture-items")?.pluginSlug).toBe("fixture");
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.entitySchemas["fixture-entity"]?.propertiesSchema)).toBe(true);
	});

	it("normalizes absent merge identity properties to an immutable empty array", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());
		const collection = registry.getEntitySchema("collection");
		assert(collection);

		expect(collection.mergeIdentityProperties).toEqual([]);
		expect(Object.isFrozen(collection.mergeIdentityProperties)).toBe(true);
	});

	it("preserves declared entity user-state restrictions and permissive defaults", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());

		expect(registry.getEntitySchema("fixture-entity")?.userState?.deniedOperations).toEqual([
			"clear",
			"merge",
		]);
		expect(registry.getEntitySchema("collection")?.userState).toBeUndefined();
	});

	it("replaces the snapshot only after the next source passes validation", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());
		const original = registry.getSnapshot();
		const source = pluginDefinitionSource();
		const entitySchema = source.entitySchemas[0];
		assert(entitySchema);

		expect(() =>
			registry.replace({
				...source,
				entitySchemas: [...source.entitySchemas, entitySchema],
			}),
		).toThrow(/Duplicate entity schema slug/);
		expect(registry.getSnapshot()).toBe(original);
	});

	it("converts nested event records back into a complete source", () => {
		const source = pluginDefinitionSource();
		const snapshot = buildDefinitionSnapshot(source);

		expect(buildDefinitionSnapshot(definitionSourceFromSnapshot(snapshot))).toEqual(snapshot);
	});

	it("validates every kernel and plugin saved view before snapshot admission", () => {
		const source = pluginDefinitionSource();
		expect(() => buildDefinitionSnapshot(source)).not.toThrow();
	});

	it("fails fast on forbidden slugs and dangling references", () => {
		const source = pluginDefinitionSource();
		const entitySchema = source.entitySchemas[0];
		const savedView = source.savedViews[0];
		const relationshipSchema = source.relationshipSchemas[0];
		assert(entitySchema);
		assert(savedView);
		assert(relationshipSchema);

		expect(() =>
			buildDefinitionSnapshot({
				...source,
				entitySchemas: [{ ...entitySchema, slug: "bad/entity" }, ...source.entitySchemas.slice(1)],
			}),
		).toThrow(/cannot contain '\/'/);
		expect(() =>
			buildDefinitionSnapshot({
				...source,
				savedViews: [{ ...savedView }, ...source.savedViews],
			}),
		).toThrow(/Duplicate saved view slug/);
		expect(() =>
			buildDefinitionSnapshot({
				...source,
				savedViews: [
					{
						...savedView,
						layouts: {
							...savedView.layouts,
							grid: { ...savedView.layouts.grid, entityIdField: "missing" },
						},
					},
					...source.savedViews.slice(1),
				],
			}),
		).toThrow(
			"Invalid saved view collections: Grid layout: mapping field 'missing' is not in its root projection",
		);
		expect(() =>
			buildDefinitionSnapshot({
				...source,
				savedViews: [
					{ ...savedView, entitySchemaSlug: EntitySchemaSlug.make("missing") },
					...source.savedViews.slice(1),
				],
			}),
		).toThrow(/Saved view .* references missing entity schema missing/);
		expect(() =>
			buildDefinitionSnapshot({
				...source,
				relationshipSchemas: [
					{ ...relationshipSchema, sourceEntitySchemaSlug: "missing" },
					...source.relationshipSchemas.slice(1),
				],
			}),
		).toThrow(/Relationship schema .* references missing entity schema missing/);
	});

	it("delegates property validation to the property-schema runtime", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());

		expect(
			Effect.runSyncExit(registry.validateEventProperties("fixture-entity", "changed", {}))._tag,
		).toBe("Failure");
		expect(
			Effect.runSync(
				registry.validateEventProperties("fixture-entity", "changed", { value: "next" }),
			),
		).toEqual({ value: "next" });
	});
});
