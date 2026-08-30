import {
	aggregate,
	ascending,
	castText,
	column,
	contains,
	descending,
	document,
	eq,
	field,
	join,
	literal,
	or,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	buildSavedViewLayoutProjections,
	entityBrowserCountRecipe,
	entityBrowserRecipe,
	resultsTableRecipe,
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

const browserSettings = {
	pageSize: 2,
	addAction: null,
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "selection",
	entityIdField: "idAlias",
	layouts: ["grid", "list"],
	searchFields: ["nameAlias"],
	ownerPluginIdField: "ownerAlias",
	entitySchemaSlugField: "schemaAlias",
	sortChoices: [
		{
			name: "name-desc",
			label: "Name descending",
			orderBy: [{ field: "nameAlias", direction: "desc" }],
		},
	],
} as const;

const browserSource = document({
	ignored: aggregate(entity, { measures: [{ key: "total", aggregation: { function: "count" } }] }),
	selection: rows(entity, {
		limit: 40,
		orderBy: [ascending(column(entity, "createdAt"))],
		fields: [
			field("idAlias", column(entity, "id")),
			field("nameAlias", column(entity, "name")),
			field("ownerAlias", column(entity, "entitySchemaPluginId")),
			field("schemaAlias", column(entity, "entitySchemaSlug")),
		],
	}),
});

describe("saved-view recipes", () => {
	it("prepares a generated rows document with filtering, ordering, and pagination", () => {
		const prepared = savedViewRecipe({
			layout: { type: "card", mapping: projections.grid.mappings },
			source: {
				limit: 2,
				after: "cursor",
				type: "generated",
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
									translationStatus: "pending",
									primaryMetadata: "2026-08-12",
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

	it("prepares the named entity selection with runtime pagination and canonical fields", () => {
		const prepared = Result.getOrThrow(
			entityBrowserRecipe({
				after: "next-page",
				settings: browserSettings,
				queryDocument: browserSource,
			}),
		);
		const query = prepared.document.queries.entityBrowser;
		if (!query) {
			throw new Error("Expected the entity-browser query");
		}

		expect(Object.keys(prepared.document.queries)).toEqual(["entityBrowser"]);
		expect(query.output).toMatchObject({
			type: "rows",
			pagination: { limit: 2, after: "next-page" },
			orderBy: [
				{ direction: "asc", expr: column(entity, "createdAt") },
				{ direction: "asc", expr: column(entity, "id") },
			],
		});
		expect(query.output.type === "rows" ? query.output.fields.slice(-3) : []).toEqual([
			field("__entityBrowserName", column(entity, "name")),
			field("__entityBrowserPopulationStatus", column(entity, "populationStatus")),
			field("__entityBrowserTranslationStatus", column(entity, "translationStatus")),
		]);
	});

	it("applies declared search and sort without mutating the stored source", () => {
		const before = structuredClone(browserSource);
		const prepared = Result.getOrThrow(
			entityBrowserRecipe({
				searchText: "iran",
				after: "runtime-cursor",
				sortChoice: "name-desc",
				settings: browserSettings,
				queryDocument: browserSource,
			}),
		);
		const query = prepared.document.queries.entityBrowser;
		if (query?.output.type !== "rows") {
			throw new Error("Expected rows output");
		}

		expect(query.where).toEqual(or(contains(castText(column(entity, "name")), literal("iran"))));
		expect(query.output.orderBy).toEqual([
			descending(column(entity, "name")),
			ascending(column(entity, "id")),
		]);
		expect(query.output.pagination).toEqual({ limit: 2, after: "runtime-cursor" });
		expect(browserSource).toEqual(before);
		expect(
			Result.isFailure(
				entityBrowserRecipe({
					sortChoice: "undeclared",
					settings: browserSettings,
					queryDocument: browserSource,
				}),
			),
		).toBe(true);
	});

	it("decodes canonical entity references and rejects duplicate IDs within a page", () => {
		const prepared = Result.getOrThrow(
			entityBrowserRecipe({ settings: browserSettings, queryDocument: browserSource }),
		);
		const row = {
			ownerAlias: null,
			idAlias: "book-1",
			schemaAlias: "book",
			__entityBrowserName: "Piranesi",
			__entityBrowserPopulationStatus: "ready",
			__entityBrowserTranslationStatus: "pending",
		};
		const decoded = Result.getOrThrow(
			prepared.decode({
				data: { entityBrowser: { type: "rows", pageInfo, items: [row] } },
			}),
		);
		expect(decoded).toEqual({
			pageInfo,
			items: [
				{
					cells: [],
					name: "Piranesi",
					entityId: "book-1",
					ownerPluginId: null,
					entitySchemaSlug: "book",
					sync: { populationStatus: "ready", translationStatus: "pending" },
				},
			],
		});

		const duplicate = prepared.decode({
			data: { entityBrowser: { type: "rows", pageInfo, items: [row, row] } },
		});
		if (Result.isSuccess(duplicate)) {
			throw new Error("Expected duplicate entity IDs to fail");
		}
		expect(String(duplicate.failure)).toContain(
			"Entity-browser page contains duplicate entity ID 'book-1'",
		);
	});

	it("decodes configured entity-browser table columns in declared order", () => {
		const settings = {
			...browserSettings,
			layouts: ["grid", "table"],
			tableColumns: [
				{ label: "Name", field: "nameAlias", displayKind: "text" },
				{ label: "Details", field: "details", displayKind: "json" },
			],
		} as const;
		const prepared = Result.getOrThrow(
			entityBrowserRecipe({ settings, queryDocument: browserSource }),
		);
		const decoded = Result.getOrThrow(
			prepared.decode({
				data: {
					entityBrowser: {
						type: "rows",
						pageInfo,
						items: [
							{
								details: null,
								ownerAlias: null,
								idAlias: "book-1",
								schemaAlias: "book",
								nameAlias: "Piranesi",
								__entityBrowserName: "Piranesi",
								__entityBrowserPopulationStatus: "ready",
								__entityBrowserTranslationStatus: "none",
							},
						],
					},
				},
			}),
		);

		expect(decoded.items[0]?.cells).toEqual([
			{ key: "nameAlias", label: "Name", value: { displayKind: "text", value: "Piranesi" } },
			{ key: "details", label: "Details", value: { displayKind: "json", value: null } },
		]);
	});

	it("counts distinct selected IDs without selection pagination", () => {
		const prepared = Result.getOrThrow(entityBrowserCountRecipe(browserSource, browserSettings));

		expect(prepared.document).toEqual({
			queries: {
				entityBrowserCount: {
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
					data: { entityBrowserCount: { type: "aggregate", items: [{ total: 7 }] } },
				}),
			),
		).toBe(7);
	});

	it("keeps browser count search meaning aligned with selection", () => {
		const prepared = Result.getOrThrow(
			entityBrowserCountRecipe(browserSource, browserSettings, { searchText: "iran" }),
		);
		const query = prepared.document.queries.entityBrowserCount;
		expect(query?.where).toEqual(or(contains(castText(column(entity, "name")), literal("iran"))));
	});

	it("decodes typed composite result keys, null cells, and distinct rows for one entity", () => {
		const settings = {
			pageSize: 2,
			sourceName: "events",
			rowKeyFields: ["sequence", "variant"],
			entityLink: { entityIdField: "entityId" },
			columns: [
				{ label: "Value", field: "value", displayKind: "text" },
				{ label: "Amount", field: "amount", displayKind: "number" },
				{ label: "Artwork", field: "artwork", displayKind: "managed-asset" },
			],
		} as const;
		const source = document({
			events: rows(entity, {
				limit: 40,
				fields: [
					field("sequence", literal(1)),
					field("variant", literal("1")),
					field("entityId", column(entity, "id")),
					field("value", column(entity, "name")),
					field("amount", literal(null)),
					field("artwork", literal({ type: "local", key: "covers/book.webp" })),
				],
			}),
		});
		const storedSource = structuredClone(source);
		const prepared = Result.getOrThrow(
			resultsTableRecipe({ settings, after: "runtime-cursor", queryDocument: source }),
		);
		expect(prepared.document.queries.resultsTable?.output).toMatchObject({
			type: "rows",
			pagination: { limit: 2, after: "runtime-cursor" },
		});
		expect(source).toEqual(storedSource);
		const decoded = Result.getOrThrow(
			prepared.decode({
				data: {
					resultsTable: {
						pageInfo,
						type: "rows",
						items: [
							{
								sequence: 1,
								variant: "1",
								amount: null,
								value: "First",
								entityId: "same",
								artwork: { type: "local", key: "covers/book.webp" },
							},
							{
								variant: 1,
								amount: null,
								artwork: null,
								sequence: "1",
								value: "Second",
								entityId: "same",
							},
						],
					},
				},
			}),
		);

		expect(decoded.items.map(({ key }) => key)).toEqual([
			'[{"type":"number","value":1},{"type":"string","value":"1"}]',
			'[{"type":"string","value":"1"},{"type":"number","value":1}]',
		]);
		expect(decoded.items.map(({ entityId }) => entityId)).toEqual(["same", "same"]);
		expect(decoded.items[0]?.cells[1]?.value).toEqual({ displayKind: "number", value: null });
		expect(decoded.items[0]?.cells[2]?.value).toEqual({
			displayKind: "managed-asset",
			value: { type: "local", key: "covers/book.webp" },
		});
		expect(decoded.items[1]?.cells[2]?.value).toEqual({
			value: null,
			displayKind: "managed-asset",
		});
	});

	it("rejects missing, null, and duplicate general result row keys", () => {
		const prepared = Result.getOrThrow(
			resultsTableRecipe({
				settings: {
					pageSize: 2,
					entityLink: null,
					sourceName: "events",
					rowKeyFields: ["key"],
					columns: [{ label: "Value", field: "value", displayKind: "text" }],
				},
				queryDocument: document({
					events: rows(entity, {
						fields: [field("key", column(entity, "id")), field("value", column(entity, "name"))],
					}),
				}),
			}),
		);
		const decode = (items: readonly Record<string, unknown>[]) =>
			prepared.decode({ data: { resultsTable: { type: "rows", pageInfo, items } } });

		expect(Result.isFailure(decode([{ value: "Missing" }]))).toBe(true);
		expect(Result.isFailure(decode([{ key: null, value: "Null" }]))).toBe(true);
		expect(
			Result.isFailure(
				decode([
					{ key: 1, value: "First" },
					{ key: 1, value: "Second" },
				]),
			),
		).toBe(true);
	});
});
