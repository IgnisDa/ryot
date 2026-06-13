import { describe, expect, it } from "bun:test";

import { createQueryDefinition } from "~/lib/test-fixtures";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views";

import {
	buildBuiltinSavedViewInputs,
	buildBuiltinTrackerEntitySchemaLinks,
	buildLibraryEntityInput,
} from "./builders";

describe("builtin bootstrap helpers", () => {
	it("builds tracker entity schema links from built-in manifests", () => {
		expect(
			buildBuiltinTrackerEntitySchemaLinks({
				trackers: [{ id: "tracker-1", slug: "media" }],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", trackerSlug: "media" }],
			}),
		).toEqual([{ trackerId: "tracker-1", entitySchemaId: "schema-1" }]);
	});

	it("throws when a schema link references a missing tracker", () => {
		expect(() =>
			buildBuiltinTrackerEntitySchemaLinks({
				trackers: [],
				entitySchemas: [{ id: "schema-1", slug: "book" }],
				schemaLinks: [{ slug: "book", trackerSlug: "media" }],
			}),
		).toThrow("Missing built-in tracker for entity schema book");
	});

	it("builds built-in saved views from built-in manifests", () => {
		const queryDefinition = createQueryDefinition({
			scope: ["book"],
			relationshipJoins: [
				{
					required: true,
					key: "inLibrary",
					direction: "outgoing",
					kind: "latestRelationship",
					relationshipSchemaSlug: "in-library",
				},
			],
			sort: {
				direction: "asc",
				expression: {
					type: "reference",
					reference: { type: "entity", slug: "book", path: ["name"] },
				},
			},
		});
		const displayConfiguration = createDefaultDisplayConfiguration("book");

		expect(
			buildBuiltinSavedViewInputs({
				trackers: [{ id: "tracker-1", slug: "media" }],
				entitySchemas: [
					{
						slug: "book",
						id: "schema-1",
						icon: "book-open",
						accentColor: "#5B7FFF",
					},
				],
				savedViews: [
					{
						slug: "all-books",
						name: "All Books",
						trackerSlug: "media",
						displayConfiguration,
						entitySchemaSlug: "book",
						relationshipJoins: [
							{
								required: true,
								key: "inLibrary",
								direction: "outgoing",
								kind: "latestRelationship",
								relationshipSchemaSlug: "in-library",
							},
						],
					},
				],
			}),
		).toEqual([
			{
				isBuiltin: true,
				icon: "book-open",
				slug: "all-books",
				name: "All Books",
				displayConfiguration,
				trackerId: "tracker-1",
				accentColor: "#5B7FFF",
				queryDefinition: { ...queryDefinition, scope: ["book"] },
			},
		]);
	});

	it("uses average user rating as the built-in media callout", () => {
		const displayConfiguration = createDefaultDisplayConfiguration("book");

		expect(displayConfiguration.grid.calloutProperty).toEqual({
			type: "reference",
			reference: {
				aggregation: "avg",
				type: "event-aggregate",
				eventSchemaSlug: "review",
				path: ["properties", "rating"],
			},
		});
		expect(displayConfiguration.list.calloutProperty).toEqual({
			type: "reference",
			reference: {
				aggregation: "avg",
				type: "event-aggregate",
				eventSchemaSlug: "review",
				path: ["properties", "rating"],
			},
		});
	});

	it("builds built-in saved views without trackers", () => {
		const queryDefinition = createQueryDefinition({ scope: [] });
		const displayConfiguration = createDefaultDisplayConfiguration("collection");

		expect(
			buildBuiltinSavedViewInputs({
				entitySchemas: [],
				trackers: [{ id: "tracker-1", slug: "media" }],
				savedViews: [
					{
						icon: "folders",
						queryDefinition,
						slug: "collections",
						name: "Collections",
						displayConfiguration,
						accentColor: "#F59E0B",
					},
				],
			}),
		).toEqual([
			{
				icon: "folders",
				queryDefinition,
				isBuiltin: true,
				slug: "collections",
				name: "Collections",
				trackerId: undefined,
				displayConfiguration,
				accentColor: "#F59E0B",
			},
		]);
	});

	it("throws when a saved view references a missing built-in entity schema", () => {
		expect(() =>
			buildBuiltinSavedViewInputs({
				entitySchemas: [],
				trackers: [{ id: "tracker-1", slug: "media" }],
				savedViews: [
					{
						slug: "all-books",
						name: "All Books",
						trackerSlug: "media",
						entitySchemaSlug: "book",
						displayConfiguration: createDefaultDisplayConfiguration("book"),
					},
				],
			}),
		).toThrow("Missing built-in entity schema for saved view All Books");
	});
});

describe("library entity bootstrap helper", () => {
	it("builds library entity input from builtin entity schemas", () => {
		expect(
			buildLibraryEntityInput({
				entitySchemas: [
					{ id: "schema-lib", slug: "library" },
					{ id: "schema-book", slug: "book" },
				],
			}),
		).toEqual({ entitySchemaId: "schema-lib" });
	});

	it("throws when the library schema is missing from builtin entity schemas", () => {
		expect(() =>
			buildLibraryEntityInput({
				entitySchemas: [{ id: "schema-book", slug: "book" }],
			}),
		).toThrow("Missing built-in library entity schema");
	});
});
