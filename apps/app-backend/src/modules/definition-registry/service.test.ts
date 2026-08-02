import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import fitnessPlugin from "@ryot/fitness-plugin";
import mediaPlugin from "@ryot/media-plugin";
import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import { validateDisplayConfiguration } from "#modules/saved-views/display-configuration-validation";

import { kernelDefinitionSource } from "./kernel-source";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSource,
	makeDefinitionRegistry,
} from "./service";

const pluginDefinitionSource = (): DefinitionSource => {
	const kernel = kernelDefinitionSource();
	const plugins: ReadonlyArray<PluginManifest> = [mediaPlugin, fitnessPlugin];
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

		expect(registry.getEntitySchema("movie")?.eventSchemas["progress"]?.name).toBe("Progress");
		expect(registry.getRelationshipSchema("in-library")?.name).toBe("In Library");
		expect(registry.getSignalSchema("review.created")?.name).toBe("Review Created");
		expect(registry.getSignalSchema("review.created")?.notificationScriptSlug).toBe(
			"automation.media-notification",
		);
		expect(registry.getEntitySchema("collection")?.pluginSlug).toBeNull();
		expect(registry.getEntitySchema("movie")?.pluginSlug).toBe("media");
		expect(registry.getSavedView("collections")?.pluginSlug).toBeNull();
		expect(registry.getSavedView("all-movies")?.pluginSlug).toBe("media");
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.entitySchemas["movie"]?.propertiesSchema)).toBe(true);
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

		expect(registry.getEntitySchema("library")?.userState?.deniedOperations).toEqual([
			"clear",
			"merge",
		]);
		expect(registry.getEntitySchema("movie")?.userState).toBeUndefined();
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

	it("validates every kernel and plugin saved-view display configuration", () => {
		const source = pluginDefinitionSource();
		const schemaBySlug = new Map(source.entitySchemas.map((schema) => [schema.slug, schema]));
		expect(
			source.savedViews.find(({ slug }) => slug === "collections")?.displayConfiguration.table
				.columns,
		).toHaveLength(1);
		return Effect.runPromise(
			Effect.forEach(
				source.savedViews,
				(view) =>
					validateDisplayConfiguration({
						displayConfig: view.displayConfiguration,
						loadSchemas: (slugs) =>
							Effect.sync(() =>
								slugs.map((slug) => {
									const schema = schemaBySlug.get(slug);
									assert(schema, `Missing entity schema for ${slug}`);
									return { slug, propertiesSchema: schema.propertiesSchema };
								}),
							),
					}),
				{ discard: true },
			),
		);
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
				relationshipSchemas: [
					{ ...relationshipSchema, sourceEntitySchemaSlug: "missing" },
					...source.relationshipSchemas.slice(1),
				],
			}),
		).toThrow(/Relationship schema .* references missing entity schema missing/);
	});

	it("delegates property validation to the property-schema runtime", () => {
		const registry = makeDefinitionRegistry(pluginDefinitionSource());

		expect(Effect.runSyncExit(registry.validateEventProperties("movie", "progress", {}))._tag).toBe(
			"Failure",
		);
		expect(
			Effect.runSync(
				registry.validateEventProperties("movie", "progress", { progressPercent: 10 }),
			),
		).toEqual({ progressPercent: 10 });
	});
});
