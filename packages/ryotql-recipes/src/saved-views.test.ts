import {
	aggregate,
	ascending,
	column,
	document,
	eq,
	field,
	join,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildSavedViewLayoutProjections,
	savedViewCountRecipe,
	savedViewRecipe,
} from "./saved-views";

const entity = table("entity", "entity");
const projections = buildSavedViewLayoutProjections({
	grid: {
		entity,
		card: {
			image: column(entity, "image"),
			title: column(entity, "name"),
			callout: { displayKind: "number", expression: column(entity, "score") },
			overline: { displayKind: "text", expression: literal("Book") },
			primaryMetadata: { displayKind: "date", expression: column(entity, "publishedAt") },
			secondaryMetadata: null,
		},
	},
	list: {
		entity,
		card: {
			image: null,
			callout: null,
			overline: null,
			primaryMetadata: null,
			secondaryMetadata: null,
			title: column(entity, "name"),
		},
	},
	table: {
		entity,
		image: column(entity, "image"),
		columns: [
			{ label: "Name", displayKind: "text", expression: column(entity, "name") },
			{ label: "Score", displayKind: "number", expression: column(entity, "score") },
			{ label: "Active", displayKind: "boolean", expression: column(entity, "active") },
			{ label: "Published", displayKind: "date", expression: column(entity, "publishedAt") },
			{ label: "Details", displayKind: "json", expression: column(entity, "details") },
		],
	},
});

const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" } as const;

describe("saved-view recipes", () => {
	it("prepares a generated rows document with filtering, ordering, and pagination", () => {
		const prepared = savedViewRecipe({
			layout: { type: "card", mapping: projections.grid.mappings },
			source: {
				type: "generated",
				after: "cursor",
				limit: 2,
				fields: projections.grid.fields,
				entitySchemaSlugs: ["smartphone", "tablet"],
				orderBy: [ascending(column(entity, "createdAt"))],
				where: eq(column(entity, "status"), literal("active")),
			},
		});

		expect(prepared.document.queries.savedView).toMatchObject({
			output: {
				type: "rows",
				pagination: { after: "cursor", limit: 2 },
				orderBy: [{ direction: "asc", expr: { field: "createdAt", tableAlias: "entity" } }],
			},
			where: {
				type: "and",
				predicates: [
					{
						type: "in",
						expr: { field: "entitySchemaSlug", tableAlias: "entity" },
						values: [{ value: "smartphone" }, { value: "tablet" }],
					},
					{ type: "comparison", operator: "eq", right: { value: "active" } },
				],
			},
		});
	});

	it("decodes plain card rows with persisted display metadata and pagination", () => {
		const prepared = savedViewRecipe({
			layout: { type: "card", mapping: projections.grid.mappings },
			source: {
				type: "persisted",
				queryDocument: document({
					custom: rows(entity, { fields: projections.grid.fields, limit: 2 }),
				}),
			},
		});

		expect(prepared.document.queries).toHaveProperty("savedView");
		expect(
			Result.getOrThrow(
				prepared.decode({
					data: {
						savedView: {
							pageInfo,
							type: "rows",
							items: [
								{
									callout: 4.5,
									overline: "Book",
									title: "Piranesi",
									entityId: "book-1",
									populationStatus: "ready",
									primaryMetadata: "2026-08-12",
									translationStatus: "pending",
									image: { type: "remote", url: "https://example.com/cover.jpg" },
								},
							],
						},
					},
				}),
			),
		).toEqual({
			pageInfo,
			items: [
				{
					title: "Piranesi",
					entityId: "book-1",
					secondaryMetadata: undefined,
					callout: { displayKind: "number", value: 4.5 },
					overline: { displayKind: "text", value: "Book" },
					primaryMetadata: { displayKind: "date", value: "2026-08-12" },
					image: { type: "remote", url: "https://example.com/cover.jpg" },
					sync: { populationStatus: "ready", translationStatus: "pending" },
				},
			],
		});
	});

	it("decodes every table display kind and preserves null as a value state", () => {
		const prepared = savedViewRecipe({
			layout: { type: "table", mapping: projections.table.mappings },
			source: { type: "generated", entitySchemaSlugs: ["book"], fields: projections.table.fields },
		});
		const decoded = Result.getOrThrow(
			prepared.decode({
				data: {
					savedView: {
						pageInfo: { ...pageInfo, hasMore: false, nextCursor: null },
						type: "rows",
						items: [
							{
								image: null,
								column1: null,
								column2: true,
								entityId: "book-1",
								column0: "Piranesi",
								column3: "2026-08-12",
								column4: { pages: 272 },
								translationStatus: "none",
								populationStatus: "pending",
							},
						],
					},
				},
			}),
		);

		expect(decoded.items[0]).toEqual({
			entityId: "book-1",
			image: null,
			sync: { populationStatus: "pending", translationStatus: "none" },
			cells: [
				{ key: "column0", label: "Name", value: { displayKind: "text", value: "Piranesi" } },
				{ key: "column1", label: "Score", value: { displayKind: "number", value: null } },
				{ key: "column2", label: "Active", value: { displayKind: "boolean", value: true } },
				{
					key: "column3",
					label: "Published",
					value: { displayKind: "date", value: "2026-08-12" },
				},
				{
					key: "column4",
					label: "Details",
					value: { displayKind: "json", value: { pages: 272 } },
				},
			],
		});
	});

	it("rejects malformed plain values according to display metadata", () => {
		const prepared = savedViewRecipe({
			layout: { type: "card", mapping: projections.grid.mappings },
			source: {
				type: "generated",
				fields: projections.grid.fields,
				entitySchemaSlugs: ["book"],
			},
		});

		expect(
			Result.isFailure(
				prepared.decode({
					data: {
						savedView: {
							pageInfo,
							type: "rows",
							items: [
								{
									image: null,
									title: "Book",
									callout: "4.5",
									overline: "Book",
									entityId: "book-1",
									populationStatus: "none",
									translationStatus: "none",
									primaryMetadata: "not-a-date",
								},
							],
						},
					},
				}),
			),
		).toBe(true);
	});

	it("prepares and decodes an aggregate count from the rows source", () => {
		const related = table("entity", "related");
		const where = eq(column(entity, "status"), literal("active"));
		const joins = [join("inner", related, eq(column(entity, "id"), column(related, "id")))];
		const source = document({
			savedView: rows(entity, {
				where,
				joins,
				fields: [field("id", column(entity, "id"))],
			}),
		});
		const prepared = Result.getOrThrow(savedViewCountRecipe(source, "id"));

		expect(prepared.document).toEqual({
			queries: {
				savedViewCount: {
					where,
					joins,
					from: entity,
					output: {
						type: "aggregate",
						measures: [
							{
								key: "total",
								aggregation: { function: "countDistinct", expr: column(entity, "id") },
							},
						],
					},
				},
			},
		});
		expect(
			Result.getOrThrow(
				prepared.decode({
					data: { savedViewCount: { type: "aggregate", items: [{ total: 42 }] } },
				}),
			),
		).toBe(42);
	});

	it("prepares and decodes a distinct aggregate count from a mapped rows field", () => {
		const source = document({
			savedView: rows(entity, { fields: [field("entityId", column(entity, "id"))] }),
		});
		const prepared = Result.getOrThrow(savedViewCountRecipe(source, "entityId"));

		expect(prepared.document).toEqual({
			queries: {
				savedViewCount: {
					from: entity,
					output: {
						type: "aggregate",
						measures: [
							{
								key: "total",
								aggregation: { function: "countDistinct", expr: column(entity, "id") },
							},
						],
					},
				},
			},
		});
		expect(
			Result.getOrThrow(
				prepared.decode({ data: { savedViewCount: { type: "aggregate", items: [{ total: 3 }] } } }),
			),
		).toBe(3);
	});

	it("fails distinct count preparation when the mapped field is not selected", () => {
		const source = document({
			savedView: rows(entity, { fields: [field("id", column(entity, "id"))] }),
		});

		expect(Result.isFailure(savedViewCountRecipe(source, "entityId"))).toBe(true);
	});

	it("fails count preparation for empty, multiple, and non-row documents", () => {
		const aggregateDocument = document({
			count: aggregate(entity, {
				measures: [{ key: "total", aggregation: { function: "count" } }],
			}),
		});
		const multipleDocument = document({
			first: rows(entity, { fields: [] }),
			second: rows(entity, { fields: [] }),
		});

		expect(Result.isFailure(savedViewCountRecipe(document({}), "id"))).toBe(true);
		expect(Result.isFailure(savedViewCountRecipe(multipleDocument, "id"))).toBe(true);
		expect(Result.isFailure(savedViewCountRecipe(aggregateDocument, "id"))).toBe(true);
	});
});
