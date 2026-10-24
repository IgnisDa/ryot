import { collectionFieldsToAppSchema } from "@ryot-app/contract/modules/collections/fields";
import type { Filter } from "@ryot-app/contract/modules/filters/schemas";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { DateTime, Result, Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import {
	allCollectionsRecipe,
	collectionHeaderRecipe,
	collectionMemberControls,
	type CollectionMemberFields,
	collectionMembersAggregateRecipe,
	collectionMembersCountRecipe,
	collectionMembersCountsRecipe,
	collectionMembershipRecipe,
	collectionMembershipTargetRecipe,
	collectionMembersRecipe,
	collectionMemberTableColumns,
} from "./collections";
import type { FilterInput } from "./filters";

const memberFields = (
	schema: CollectionMemberFields["membershipPropertiesSchema"],
	overrides: Partial<CollectionMemberFields> = {},
): CollectionMemberFields => ({
	schemas: [],
	groups: { items: [] },
	membershipPropertiesSchema: schema,
	...overrides,
});

const rating = (path: string) =>
	({
		kind: "value",
		key: "rating",
		type: "number",
		label: "Rating",
		sort: { ascending: "Lowest rated", descending: "Highest rated" },
		expression: {
			path: [path],
			type: "jsonPath",
			expr: { type: "column", field: "properties", tableAlias: "subject" },
		},
	}) as const;

const pageInfo = { limit: 7, hasMore: false, nextCursor: null };
const order = { type: "rows", items: [{ revision: 3 }], pageInfo: { ...pageInfo, limit: 2 } };

/* oxlint-disable perfectionist/sort-objects -- field declaration order is test input */
const membershipPropertiesSchema = Schema.decodeSync(AppSchema)({
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
	it("selects the membership target name for the collection manager", () => {
		const recipe = collectionMembershipTargetRecipe({ entityId: "entity-1" });
		expect(recipe.document.queries.target?.where).toMatchObject({
			left: { field: "id" },
			right: { value: "entity-1" },
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: { target: { pageInfo, type: "rows", items: [{ name: "Example item" }] } },
				}),
			),
		).toEqual({ name: "Example item" });
		expect(
			Result.getOrThrow(recipe.decode({ data: { target: { pageInfo, items: [], type: "rows" } } })),
		).toBeNull();
	});
	it("prepares and decodes the paginated collection list", () => {
		const recipe = allCollectionsRecipe({ limit: 7, after: "cursor" });
		const query = recipe.document.queries.collections;
		assert(query);

		expect(query.output).toMatchObject({
			fields: [{ key: "id" }, { key: "name" }],
			pagination: { limit: 7, after: "cursor" },
		});
		expect(query.where).toMatchObject({
			predicates: [
				{ right: { value: "collection" } },
				{ type: "isNull", expr: { field: "entitySchemaPluginId" } },
			],
		});
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

	it("decodes the collection header with its fields and rebuilt member schema", () => {
		const recipe = collectionHeaderRecipe({ collectionId: "collection-1" });
		const query = recipe.document.queries.collection;
		assert(query);
		expect(query.output).toMatchObject({ pagination: { limit: 2 } });
		expect(query.where).toMatchObject({ type: "and" });
		const fields = [{ key: "notes", type: "text", label: "Notes", required: true }] as const;
		const decodeHeader = (properties: Record<string, unknown>) =>
			Result.getOrThrow(
				recipe.decode({
					data: {
						collection: {
							type: "rows",
							pageInfo: { ...pageInfo, limit: 2 },
							items: [{ properties, name: "Favorites", entityId: "collection-1" }],
						},
					},
				}),
			);

		expect(decodeHeader({ description: "Shelf", membershipFields: fields })).toEqual({
			fields,
			name: "Favorites",
			description: "Shelf",
			entityId: "collection-1",
			membershipPropertiesSchema: collectionFieldsToAppSchema(fields),
		});
		expect(decodeHeader({})).toEqual({
			fields: [],
			description: null,
			name: "Favorites",
			entityId: "collection-1",
			membershipPropertiesSchema: null,
		});
		expect(decodeHeader({ membershipFields: membershipPropertiesSchema })).toEqual({
			fields: null,
			description: null,
			name: "Favorites",
			entityId: "collection-1",
			membershipPropertiesSchema: null,
		});
	});

	it("reads one membership's member values without the server-owned rank", () => {
		const recipe = collectionMembershipRecipe({ entityId: "unit-1", collectionId: "collection-1" });
		const decodeMembership = (items: ReadonlyArray<{ readonly properties: object }>) =>
			Result.getOrThrow(
				recipe.decode({
					data: { membership: { items, type: "rows", pageInfo: { ...pageInfo, limit: 2 } } },
				}),
			);

		expect(decodeMembership([{ properties: { rank: -3, notes: "Kept" } }])).toEqual({
			properties: { notes: "Kept" },
		});
		expect(decodeMembership([])).toBeNull();
	});

	it("renders member values that no longer match their field as empty cells", () => {
		const recipe = collectionMembersRecipe({
			collectionId: "collection-1",
			fields: memberFields(
				collectionFieldsToAppSchema([
					{ key: "score", label: "Score", type: "number", required: false },
					{ key: "notes", type: "text", label: "Notes", required: false },
				]),
			),
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					order,
					members: {
						pageInfo,
						type: "rows",
						items: [
							{
								name: "Sample",
								entityId: "unit-1",
								ownerPluginId: null,
								ownerPluginName: null,
								entitySchemaSlug: "unit",
								properties: { notes: "Kept", score: "high" },
								translationStatus: { state: "idle", availability: "none" },
								populationStatus: { state: "succeeded", availability: "complete" },
							},
						],
					},
				},
			}),
		);
		expect(result.items[0]?.cells.slice(2)).toEqual([
			{ key: "score", label: "Score", value: { value: null, displayKind: "number" } },
			{ key: "notes", label: "Notes", value: { value: "Kept", displayKind: "text" } },
		]);
	});

	it("maps member rows to entity-browser fields and schema-declared cells", () => {
		const recipe = collectionMembersRecipe({
			limit: 7,
			searchText: " sample ",
			collectionId: "collection-1",
			fields: memberFields(membershipPropertiesSchema),
			after: JSON.stringify({ revision: 3, cursor: "cursor" }),
		});
		const query = recipe.document.queries.members;
		assert(query?.output.type === "rows");
		expect(query.output.pagination).toEqual({ limit: 7, after: "cursor" });
		expect(query.joins).toHaveLength(2);
		expect(query.where).toMatchObject({
			type: "and",
			predicates: expect.arrayContaining([
				expect.objectContaining({ type: "contains", right: { value: "sample", type: "literal" } }),
			]),
		});
		expect(query.output.orderBy).toMatchObject([
			{ direction: "asc", expr: { field: "collectionRank" } },
			{ direction: "asc", expr: { field: "id" } },
		]);

		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					order,
					members: {
						pageInfo,
						type: "rows",
						items: [
							{
								name: "Sample",
								entityId: "unit-1",
								entitySchemaSlug: "unit",
								ownerPluginId: "fixture-1",
								ownerPluginName: "Fixture",
								translationStatus: { state: "idle", availability: "none" },
								populationStatus: { state: "succeeded", availability: "complete" },
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
					name: "Sample",
					entityId: "unit-1",
					entitySchemaSlug: "unit",
					ownerPluginId: "fixture-1",
					sync: {
						translationStatus: { state: "idle", availability: "none" },
						populationStatus: { state: "succeeded", availability: "complete" },
					},
				},
			],
		});
		expect(result.items[0]?.cells).toEqual([
			{ key: "name", label: "Name", value: { value: "Sample", displayKind: "text" } },
			{ key: "type", label: "Type", value: { displayKind: "text", value: "Fixture / unit" } },
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
		const emptyRecipe = collectionMembersRecipe({ collectionId: "collection-1" });
		expect(
			Result.getOrThrow(
				emptyRecipe.decode({ data: { order, members: { pageInfo, items: [], type: "rows" } } }),
			),
		).toEqual({ pageInfo, items: [], stale: false, orderRevision: 3 });
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
		const collisionSchema = Schema.decodeSync(AppSchema)({
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
			fields: memberFields(collisionSchema),
		});
		const result = Result.getOrThrow(
			recipe.decode({
				data: {
					order,
					members: {
						pageInfo,
						items: [
							{
								name: "Sample",
								entityId: "unit-1",
								ownerPluginId: "fixture-1",
								ownerPluginName: "Fixture",
								entitySchemaSlug: "unit",
								populationStatus: { availability: "complete", state: "succeeded" },
								translationStatus: { availability: "none", state: "idle" },
								properties: { name: "Custom name", type: true },
							},
						],
						type: "rows",
					},
				},
			}),
		);
		expect(result.items[0]?.cells).toEqual([
			{ key: "_name", label: "Name", value: { value: "Sample", displayKind: "text" } },
			{ key: "_type", label: "Type", value: { displayKind: "text", value: "Fixture / unit" } },
			{ key: "name", label: "Template Name", value: { value: "Custom name", displayKind: "text" } },
			{ key: "type", label: "Template Type", value: { value: true, displayKind: "boolean" } },
		]);
	});
	/* oxlint-enable perfectionist/sort-objects */

	it.each([
		["name-asc", "asc", "name"],
		["name-desc", "desc", "name"],
		["date-added-desc", "desc", "createdAt"],
		["date-added-asc", "asc", "createdAt"],
	])("builds the %s server-side sort", (sort, direction, field) => {
		const query = collectionMembersRecipe({ sort, collectionId: "collection-1" }).document.queries
			.members;
		assert(query?.output.type === "rows");
		expect(query.output.orderBy).toMatchObject([
			{ direction, expr: { field } },
			{ direction: "asc", expr: { field: "id" } },
		]);
	});

	it("binds continuation pages to their collection order and refuses changed pages", () => {
		const first = collectionMembersRecipe({ collectionId: "shelf" });
		const firstPage = Result.getOrThrow(
			first.decode({
				data: {
					order,
					members: {
						items: [],
						type: "rows",
						pageInfo: { ...pageInfo, hasMore: true, nextCursor: "next" },
					},
				},
			}),
		);
		assert(firstPage.pageInfo.nextCursor);
		const next = collectionMembersRecipe({
			collectionId: "shelf",
			after: firstPage.pageInfo.nextCursor,
		});
		expect(next.document.queries.members?.output).toMatchObject({ pagination: { after: "next" } });
		const current = Result.getOrThrow(
			next.decode({ data: { order, members: { pageInfo, items: [], type: "rows" } } }),
		);
		expect(current).toMatchObject({ stale: false, orderRevision: 3 });
		const changed = Result.getOrThrow(
			next.decode({
				data: {
					order: { ...order, items: [{ revision: 4 }] },
					members: { pageInfo, items: [], type: "rows" },
				},
			}),
		);
		expect(changed).toMatchObject({ items: [], stale: true, orderRevision: 4 });
	});

	it("counts the filtered members before pagination", () => {
		const recipe = collectionMembersCountRecipe({
			searchText: "sample",
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

	it("counts members for a batch of collections", () => {
		const recipe = collectionMembersCountsRecipe({
			collectionIds: ["collection-1", "collection-2"],
		});
		const query = recipe.document.queries.collectionMembersCounts;
		assert(query);
		expect(query.where).toMatchObject({
			predicates: [
				{
					predicates: [
						{ right: { value: "member-of" }, left: { field: "relationshipSchemaSlug" } },
						{ type: "isNull", expr: { field: "relationshipSchemaPluginId" } },
					],
				},
				{
					expr: { field: "targetEntityId" },
					values: [{ value: "collection-1" }, { value: "collection-2" }],
				},
			],
		});
		expect(query.output).toMatchObject({
			groupBy: [{ key: "collectionId" }],
			measures: [
				{
					key: "total",
					aggregation: { function: "countDistinct", expr: { field: "sourceEntityId" } },
				},
			],
		});
		expect(
			Result.getOrThrow(
				recipe.decode({
					data: {
						collectionMembersCounts: {
							type: "aggregate",
							items: [
								{ total: 2, collectionId: "collection-1" },
								{ total: 1, collectionId: "collection-2" },
							],
						},
					},
				}),
			),
		).toEqual({ "collection-1": 2, "collection-2": 1 });
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
									entitySchemaSlug: "unit",
									ownerPluginId: "fixture-1",
									ownerPluginName: "Fixture",
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
					entitySchemaSlug: "unit",
					ownerPluginId: "fixture-1",
					ownerPluginName: "Fixture",
					typeLabel: "Fixture / unit",
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

	describe("member filters", () => {
		const now = DateTime.makeUnsafe("2026-03-10T12:00:00.000Z");
		const groups = {
			items: [
				{
					count: 2,
					ownerPluginId: "fixture",
					entitySchemaSlug: "unit",
					ownerPluginName: "Fixture",
					typeLabel: "Fixture / unit",
				},
				{
					count: 1,
					ownerPluginId: null,
					ownerPluginName: null,
					typeLabel: "Collections",
					entitySchemaSlug: "collection",
				},
			],
		};
		const filterSchema = collectionFieldsToAppSchema([
			{ key: "type", type: "text", label: "Type", required: false },
			{ type: "text", required: false, key: "collections", label: "Collections" },
		]);
		const schemas = [
			{ slug: "unit", pluginId: "fixture", browse: { fields: [rating("score")] } },
			{ browse: null, pluginId: null, slug: "collection" },
		];
		const fields = memberFields(filterSchema, { groups, schemas });
		const controls = collectionMemberControls(fields);
		const filter: Filter = {
			type: "and",
			filters: [
				{ operator: "anyOf", field: "member-type", values: ["fixture/unit"] },
				{ operator: "anyOf", values: ["col-2"], field: "collections" },
				{ value: "x", operator: "contains", field: "membership.type" },
				{ value: "y", operator: "is", field: "membership.collections" },
			],
		};
		const compiled = (applied: Filter | undefined) => {
			const base = { fields, searchText: "sample", collectionId: "collection-1" };
			const input: FilterInput = applied ? { now, filter: applied } : {};
			const members = collectionMembersRecipe({ ...base, ...input }).document.queries.members;
			const count = collectionMembersCountRecipe({ ...base, ...input }).document.queries.count;
			assert(members?.output.type === "rows");
			assert(count);
			return { count, members };
		};

		it("offers type, date added, also-in-collection, browse and membership fields", () => {
			expect(controls.filterFields.map(({ key }) => key)).toEqual([
				"member-type",
				"date-added",
				"collections",
				"rating",
				"membership.type",
				"membership.collections",
			]);
			expect(controls.filterFields[0]).toMatchObject({
				choices: [
					{ value: "fixture/unit", label: "Fixture / unit" },
					{ value: "/collection", label: "Collections" },
				],
			});
			expect(controls.filterFields[2]).toMatchObject({
				kind: "relationship",
				direction: "outgoing",
				label: "Also in collection",
				relationship: { slug: "member-of", owner: { kind: "kernel" } },
			});
			expect(controls.sortChoices.map(({ value }) => value)).toEqual([
				"name-asc",
				"name-desc",
				"date-added-asc",
				"date-added-desc",
				"rating-asc",
				"rating-desc",
			]);
		});

		it("derives property fields from supported, non-secret membership properties", () => {
			const keys = collectionMemberControls(
				memberFields(membershipPropertiesSchema),
			).filterFields.map(({ key }) => key);
			expect(keys).toEqual(
				expect.arrayContaining(["collections", "membership.notes", "membership.status"]),
			);
			expect(keys).not.toContain("member-type");
			expect(keys).not.toContain("membership.secret");
			expect(keys).not.toContain("membership.metadata");
		});

		it("compiles each field against its own expression, identically for members and count", () => {
			const { count, members } = compiled(filter);
			const where = JSON.stringify(members.where);
			expect(where).toContain('"concat"');
			expect(where).toContain('"exists"');
			expect(where).toContain('"collectionMember"');
			expect(where).toContain('"path":["type"]');
			expect(where).toContain('"path":["collections"]');
			expect(members.where).toEqual(count.where);
			expect(members.where).not.toEqual(compiled(undefined).members.where);
		});

		it("matches and sorts browse fields only for members whose schema declares them", () => {
			const { members } = compiled({ field: "rating", operator: "empty" });
			const where = JSON.stringify(members.where);
			expect(where).toContain('"value":"unit"');
			expect(where).toContain('"field":"properties","tableAlias":"collectionMember"');
			const sorted = collectionMembersRecipe({ fields, collectionId: "c", sort: "rating-desc" })
				.document.queries.members;
			assert(sorted?.output.type === "rows");
			expect(sorted.output.orderBy[0]).toMatchObject({
				direction: "desc",
				expr: { type: "conditional", whenFalse: { value: null, type: "literal" } },
			});
		});
	});
});
