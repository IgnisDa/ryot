import { Effect } from "effect";
import { assert, describe, expect, it } from "vitest";

import {
	buildDefinitionSnapshot,
	builtinDefinitionSource,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
} from "./service";

describe("definition registry", () => {
	it("serves every builtin definition kind from an immutable snapshot", () => {
		const registry = makeDefinitionRegistry();
		const snapshot = registry.getSnapshot();

		expect(registry.getEntitySchema("movie")?.eventSchemas["progress"]?.name).toBe("Progress");
		expect(registry.getRelationshipSchema("in-library")?.name).toBe("In Library");
		expect(registry.getSignalSchema("review.created")?.name).toBe("Review Created");
		expect(registry.getTracker("media")?.entitySchemaSlugs).toContain("movie");
		expect(registry.getSavedView("all-movies")?.trackerSlug).toBe("media");
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.entitySchemas["movie"]?.propertiesSchema)).toBe(true);
	});

	it("replaces the snapshot only after the next source passes validation", () => {
		const registry = makeDefinitionRegistry();
		const original = registry.getSnapshot();
		const source = builtinDefinitionSource();
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
		const source = builtinDefinitionSource();
		const snapshot = buildDefinitionSnapshot(source);

		expect(definitionSourceFromSnapshot(snapshot)).toEqual(source);
	});

	it("fails fast on forbidden slugs and dangling references", () => {
		const source = builtinDefinitionSource();
		const entitySchema = source.entitySchemas[0];
		const tracker = source.trackers[0];
		const savedView = source.savedViews[0];
		const relationshipSchema = source.relationshipSchemas[0];
		assert(entitySchema);
		assert(tracker);
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
				trackers: [{ ...tracker, entitySchemaSlugs: ["missing"] }, ...source.trackers.slice(1)],
			}),
		).toThrow(/Tracker .* references missing entity schema missing/);
		expect(() =>
			buildDefinitionSnapshot({
				...source,
				savedViews: [{ ...savedView, trackerSlug: "missing" }, ...source.savedViews.slice(1)],
			}),
		).toThrow(/Saved view .* references missing tracker missing/);
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
		const registry = makeDefinitionRegistry();

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
