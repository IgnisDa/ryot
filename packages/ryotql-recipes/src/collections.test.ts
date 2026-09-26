import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Result, Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import {
	allCollectionsRecipe,
	collectionHeaderRecipe,
	collectionMemberTableColumns,
	collectionMembersAggregateRecipe,
	collectionMembersCountRecipe,
	collectionMembersRecipe,
	type CollectionMemberSort,
} from "./collections";

const pageInfo = { limit: 7, hasMore: false, nextCursor: null };

/* oxlint-disable perfectionist/sort-objects -- field declaration order is test input */
const membershipPropertiesSchema = Schema.decodeUnknownSync(AppSchema)({
	fields: {
		rank: { position: 0, label: "Rank", type: "integer", description: "Rank" },
		notes: { position: 2, label: "Notes", type: "string", description: "Notes" },
		addedOn: { position: 5, label: "Added on", type: "date", description: "Date" },
		rating: { position: 4, label: "Rating", type: "number", description: "Rating" },
		template: { position: 1, label: "Template", type: "boolean", description: "Template" },
		updatedAt: { position: 6, label: "Updated at", type: "datetime", description: "Date time" },
		secret: { secret: true, position: 10, label: "Secret", type: "string", description: "Secret" },
		metadata: {
			position: 8,
			type: "object",
			label: "Metadata",
			properties: {},
			description: "Metadata",
		},
		tags: {
			position: 7,
			type: "array",
			label: "Tags",
			description: "Tags",
			items: { label: "Tag", type: "string", description: "Tag" },
		},
		status: {
			position: 3,
			type: "enum",
			label: "Status",
			description: "Status",
			choices: { kind: "static", values: [{ value: "active" }] },
		},
		genres: {
			position: 9,
			type: "enum-array",
			label: "Genres",
			description: "Genres",
			choices: { kind: "static", values: [{ value: "drama" }] },
		},
	},
});
/* oxlint-enable perfectionist/sort-objects */

describe("collections recipes", () => {
	it("prepares and decodes the paginated collection list", () => {
		const recipe = allCollectionsRecipe({ limit: 7, after: "cursor" });
		const query = recipe.document.queries.collections;
		assert(query);

		expect(query.output).toMatchObject({
			fields: [{ key: "id" }, { key: "name" }],
			pagination: { limit: 7, after: "cursor" },
		});
		expect(query.where).toMatchObject({ right: { value: "collection" } });
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						collections: {
							pageInfo,
							type: "rows",
							items: [{ name: "Favorites", id: "collection-1" }],
						},
					},
				}),
			),
		).toEqual({ pageInfo, items: [{ name: "Favorites", id: "collection-1" }] });
	});

	it("decodes the collection header and declared membership schema", () => {
		const recipe = collectionHeaderRecipe({ collectionId: "collection-1" });
		const query = recipe.document.queries.collection;
		assert(query);
		expect(query.output).toMatchObject({ pagination: { limit: 2 } });
		expect(query.where).toMatchObject({ type: "and" });

		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						collection: {
							type: "rows",
							pageInfo: { ...pageInfo, limit: 2 },
							items: [
								{
									name: "Favorites",
									entityId: "collection-1",
									properties: { membershipPropertiesSchema },
								},
							],
						},
					},
				}),
			),
		).toEqual({ name: "Favorites", entityId: "collection-1", membershipPropertiesSchema });
	});

	it("maps member rows to entity-browser fields and schema-declared cells", () => {
		const recipe = collectionMembersRecipe({
			limit: 7,
			after: "cursor",
			searchText: " dune ",
			membershipPropertiesSchema,
			collectionId: "collection-1",
		});
		const query = recipe.document.queries.members;
		assert(query?.output.type === "rows");
		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.joins).toHaveLength(2);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: expect.arrayContaining([
				expect.objectContaining({ type: "contains", right: { value: "dune", type: "literal" } }),
			]),
		});
		expect(query.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { type: "cast", expr: { path: ["rank"], type: "jsonPath" } } },
			{ direction: "asc", expr: { field: "name" } },
			{ direction: "asc", expr: { field: "id" } },
		]);

		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					members: {
						pageInfo,
						type: "rows",
						items: [
							{
								name: "Dune",
								entityId: "book-1",
								ownerPluginId: "media-1",
								ownerPluginName: "Media",
								entitySchemaSlug: "book",
								populationStatus: "ready",
								translationStatus: "none",
								/* oxlint-disable perfectionist/sort-objects -- wire fixture order is irrelevant */
								properties: {
									updatedAt: "2026-09-20T10:30:00Z",
									undeclared: "ignored",
									template: true,
									tags: ["classic"],
									status: "active",
									secret: "hidden",
									rating: 4.5,
									rank: 2,
									metadata: { edition: 1 },
									genres: ["drama"],
									addedOn: "2026-09-20",
								},
								/* oxlint-enable perfectionist/sort-objects */
							},
						],
					},
				},
			}),
		);

		expect(result).toMatchObject({
			pageInfo,
			items: [
				{
					name: "Dune",
					entityId: "book-1",
					ownerPluginId: "media-1",
					entitySchemaSlug: "book",
					sync: { populationStatus: "ready", translationStatus: "none" },
				},
			],
		});
		expect(result.items[0]?.cells).toEqual([
			{ key: "name", label: "Name", value: { value: "Dune", displayKind: "text" } },
			{ key: "type", label: "Type", value: { displayKind: "text", value: "Media / book" } },
			{ key: "rank", label: "Rank", value: { value: 2, displayKind: "number" } },
			{ key: "template", label: "Template", value: { value: true, displayKind: "boolean" } },
			{ key: "notes", label: "Notes", value: { value: null, displayKind: "text" } },
			{ key: "status", label: "Status", value: { value: "active", displayKind: "text" } },
			{ key: "rating", label: "Rating", value: { value: 4.5, displayKind: "number" } },
			{ key: "addedOn", label: "Added on", value: { displayKind: "date", value: "2026-09-20" } },
			{
				key: "updatedAt",
				label: "Updated at",
				value: { displayKind: "date", value: "2026-09-20T10:30:00Z" },
			},
			{ key: "tags", label: "Tags", value: { value: ["classic"], displayKind: "json" } },
			{ key: "metadata", label: "Metadata", value: { displayKind: "json", value: { edition: 1 } } },
			{ key: "genres", label: "Genres", value: { value: ["drama"], displayKind: "json" } },
		]);
	});

	it("returns stable columns for an empty page and excludes secret schema fields", () => {
		const emptyRecipe = collectionMembersRecipe({
			collectionId: "collection-1",
			membershipPropertiesSchema: null,
		});
		expect(
			Result.getOrThrow(
				emptyRecipe.decode({ data: { members: { pageInfo, items: [], type: "rows" } } }),
			),
		).toEqual({ pageInfo, items: [] });
		expect(collectionMemberTableColumns(null)).toEqual([
			{ field: "name", label: "Name", displayKind: "text" },
			{ field: "type", label: "Type", displayKind: "text" },
		]);
		expect(collectionMemberTableColumns(membershipPropertiesSchema)).toEqual([
			{ field: "name", label: "Name", displayKind: "text" },
			{ field: "type", label: "Type", displayKind: "text" },
			{ field: "rank", label: "Rank", displayKind: "number" },
			{ field: "template", label: "Template", displayKind: "boolean" },
			{ field: "notes", label: "Notes", displayKind: "text" },
			{ field: "status", label: "Status", displayKind: "text" },
			{ field: "rating", label: "Rating", displayKind: "number" },
			{ field: "addedOn", label: "Added on", displayKind: "date" },
			{ field: "updatedAt", label: "Updated at", displayKind: "date" },
			{ field: "tags", label: "Tags", displayKind: "json" },
			{ field: "metadata", label: "Metadata", displayKind: "json" },
			{ field: "genres", label: "Genres", displayKind: "json" },
		]);
	});

	/* oxlint-disable perfectionist/sort-objects -- column order is the behavior under test */
	it("keeps fixed and template name and type column keys unique", () => {
		const collisionSchema = Schema.decodeUnknownSync(AppSchema)({
			fields: {
				name: { label: "Template Name", type: "string", description: "Name" },
				type: { label: "Template Type", type: "boolean", description: "Type" },
			},
		});
		const columns = collectionMemberTableColumns(collisionSchema);
		expect(columns).toEqual([
			{ field: "_name", label: "Name", displayKind: "text" },
			{ field: "_type", label: "Type", displayKind: "text" },
			{ field: "name", label: "Template Name", displayKind: "text" },
			{ field: "type", label: "Template Type", displayKind: "boolean" },
		]);
		expect(new Set(columns.map(({ field }) => field)).size).toBe(columns.length);

		const recipe = collectionMembersRecipe({
			collectionId: "collection-1",
			membershipPropertiesSchema: collisionSchema,
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					members: {
						pageInfo,
						items: [
							{
								name: "Dune",
								entityId: "book-1",
								ownerPluginId: "media-1",
								ownerPluginName: "Media",
								entitySchemaSlug: "book",
								populationStatus: "ready",
								translationStatus: "none",
								properties: { name: "Custom name", type: true },
							},
						],
						type: "rows",
					},
				},
			}),
		);
		expect(result.items[0]?.cells).toEqual([
			{ key: "_name", label: "Name", value: { value: "Dune", displayKind: "text" } },
			{ key: "_type", label: "Type", value: { displayKind: "text", value: "Media / book" } },
			{ key: "name", label: "Template Name", value: { value: "Custom name", displayKind: "text" } },
			{ key: "type", label: "Template Type", value: { value: true, displayKind: "boolean" } },
		]);
	});
	/* oxlint-enable perfectionist/sort-objects */

	it.each<[CollectionMemberSort, string, string]>([
		["name-asc", "asc", "name"],
		["name-desc", "desc", "name"],
		["recently-added", "desc", "createdAt"],
		["oldest-added", "asc", "createdAt"],
	])("builds the %s server-side sort", (sort, direction, field) => {
		const query = collectionMembersRecipe({
			sort,
			collectionId: "collection-1",
			membershipPropertiesSchema: null,
		}).document.queries.members;
		assert(query?.output.type === "rows");
		expect(query.output.orderBy).toMatchObject([
			{ direction, expr: { field } },
			{ direction: "asc", expr: { field: "id" } },
		]);
	});

	it("counts the filtered members before pagination", () => {
		const recipe = collectionMembersCountRecipe({
			searchText: "dune",
			collectionId: "collection-1",
		});
		const query = recipe.document.queries.count;
		assert(query?.output.type === "aggregate");
		expect(query.output.measures).toMatchObject([
			{ key: "total", aggregation: { expr: { field: "id" }, function: "countDistinct" } },
		]);
		expect(
			Result.getOrThrow(
				recipe.decode({ data: { count: { type: "aggregate", items: [{ total: 3 }] } } }),
			),
		).toBe(3);
	});

	it("aggregates the whole collection by owner and schema with type labels", () => {
		const recipe = collectionMembersAggregateRecipe({ collectionId: "collection-1" });
		const query = recipe.document.queries.aggregate;
		assert(query?.output.type === "aggregate");
		expect(query.output.limit).toBe(100);
		expect(query.output.groupBy).toMatchObject([
			{ key: "entitySchemaSlug" },
			{ key: "ownerPluginName" },
			{ key: "ownerPluginId" },
		]);
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						aggregate: {
							type: "aggregate",
							pageInfo: { limit: 100, hasMore: true },
							items: [
								{
									count: 2,
									ownerPluginId: null,
									ownerPluginName: null,
									entitySchemaSlug: "collection",
								},
								{
									count: 4,
									entitySchemaSlug: "book",
									ownerPluginId: "media-1",
									ownerPluginName: "Media",
								},
							],
						},
					},
				}),
			),
		).toEqual({
			pageInfo: { limit: 100, hasMore: true },
			items: [
				{
					count: 2,
					ownerPluginId: null,
					ownerPluginName: null,
					typeLabel: "Collections",
					entitySchemaSlug: "collection",
				},
				{
					count: 4,
					entitySchemaSlug: "book",
					ownerPluginId: "media-1",
					ownerPluginName: "Media",
					typeLabel: "Media / book",
				},
			],
		});
	});

	it("rejects malformed list fields and cardinality", () => {
		const recipe = allCollectionsRecipe();
		expect(
			Result.isFailure(
				recipe.decode({
					data: { collections: { pageInfo, type: "rows", items: [{ id: 1, name: "Bad" }] } },
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(recipe.decode({ data: { collections: { items: [], type: "aggregate" } } })),
		).toBe(true);
	});
});
