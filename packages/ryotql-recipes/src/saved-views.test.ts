import type { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	ascending,
	castText,
	column,
	conditional,
	contains,
	descending,
	document,
	entitySchemaPredicate,
	field,
	literal,
	or,
	rows,
	startsWith,
	table,
} from "@ryot-app/ryotql";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	entityBrowserCountRecipe,
	entityBrowserRecipe,
	librarySearchRecipe,
	resultsTableRecipe,
} from "./saved-views";

const entity = table("entity", "entity");
const pageInfo = { limit: 2, hasMore: true, nextCursor: "next" } as const;

const browserSettings = {
	pageSize: 2,
	addAction: null,
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "selection",
	layouts: ["grid", "list"],
	searchFields: ["nameAlias"],
	summary: { image: null, subtitle: null },
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") }],
	},
	sortChoices: [
		{
			name: "name-desc",
			label: "Name descending",
			orderBy: [{ direction: "desc", field: "nameAlias" }],
		},
	],
} as const;

const itemSchema = entitySchemaPredicate(entity, "item", { kind: "kernel" });
const itemPredicate = or(itemSchema);

const browserSource = document({
	ignored: aggregate(entity, { measures: [{ key: "total", aggregation: { function: "count" } }] }),
	selection: rows(entity, {
		limit: 40,
		orderBy: [ascending(column(entity, "createdAt"))],
		fields: [field("nameAlias", column(entity, "name"))],
	}),
});

const pageLimit = (pageSize?: number) => {
	const prepared = Result.getOrThrow(
		entityBrowserRecipe({ pageSize, settings: browserSettings, queryDocument: browserSource }),
	);
	const output = prepared.document.queries.entityBrowser?.output;
	return output?.type === "rows" ? output.pagination.limit : undefined;
};

const searchSource = document({
	selection: rows(entity, {
		orderBy: [descending(column(entity, "updatedAt"))],
		fields: [
			field("nameAlias", column(entity, "name")),
			field("cover", column(entity, "properties")),
			field("year", column(entity, "createdAt")),
		],
	}),
});

const searchSettings = {
	...browserSettings,
	summary: { image: "cover", subtitle: { field: "year", displayKind: "year" } },
} as const;

const librarySearch = (
	searchText: string,
	settings: EntityBrowserSavedViewSettings = searchSettings,
) => librarySearchRecipe({ settings, limit: 8, searchText, queryDocument: searchSource });

const searchData = (items: readonly unknown[]) => ({
	data: {
		hits: { items, pageInfo, type: "rows" },
		total: { type: "aggregate", items: [{ total: 12 }] },
	},
});

describe("saved-view recipes", () => {
	it("ranks library search hits by match quality before the view order", () => {
		const prepared = Result.getOrThrow(librarySearch("50%_off\\"));
		const name = castText(column(entity, "name"));
		const rank = conditional(
			or(startsWith(name, literal("50%_off\\"))),
			literal(0),
			conditional(or(contains(name, literal(" 50%_off\\"))), literal(1), literal(2)),
		);
		const where = and(itemPredicate, or(contains(name, literal("50%_off\\"))));

		expect(sortBy(Object.keys(prepared.document.queries))).toEqual(["hits", "total"]);
		expect(prepared.document.queries.hits).toEqual(
			rows(entity, {
				where,
				limit: 8,
				orderBy: [
					ascending(rank),
					descending(column(entity, "updatedAt")),
					ascending(column(entity, "id")),
				],
				fields: [
					field("entityId", column(entity, "id")),
					field("name", column(entity, "name")),
					field("rank", rank),
					field("image", column(entity, "properties")),
					field("subtitle", column(entity, "createdAt")),
				],
			}),
		);
		expect(prepared.document.queries.total?.where).toEqual(where);
	});

	it("decodes library search hits with their declared summary", () => {
		const prepared = Result.getOrThrow(librarySearch("dark"));
		const hit = {
			rank: 0,
			name: "Dark",
			subtitle: 2017,
			entityId: "item-1",
			image: { type: "remote", url: "https://example.com/dark.jpg" },
		};

		expect(Result.getOrThrow(prepared.decode(searchData([hit])))).toEqual({
			total: 12,
			hits: [
				{
					rank: 0,
					name: "Dark",
					entityId: "item-1",
					subtitle: { value: 2017, displayKind: "year" },
					image: { type: "remote", url: "https://example.com/dark.jpg" },
				},
			],
		});
		expect(Result.isFailure(prepared.decode(searchData([hit, hit])))).toBe(true);

		const bare = Result.getOrThrow(librarySearch("dark", browserSettings));
		expect(
			Result.getOrThrow(bare.decode(searchData([{ rank: 2, name: "Darkest", entityId: "item-2" }])))
				.hits,
		).toEqual([{ rank: 2, image: null, subtitle: null, name: "Darkest", entityId: "item-2" }]);
	});

	it("refuses library search for views without search fields", () => {
		expect(Result.isFailure(librarySearch("dark", { ...browserSettings, searchFields: [] }))).toBe(
			true,
		);
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
		expect(query.output.type === "rows" ? query.output.fields.slice(-6) : []).toEqual([
			field("__entityBrowserId", column(entity, "id")),
			field("__entityBrowserOwnerPluginId", column(entity, "entitySchemaPluginId")),
			field("__entityBrowserSchemaSlug", column(entity, "entitySchemaSlug")),
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

		expect(query.where).toEqual(
			and(itemPredicate, or(contains(castText(column(entity, "name")), literal("iran")))),
		);
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

	it("overrides the configured page size only when asked", () => {
		expect(pageLimit(5)).toBe(5);
		expect(pageLimit()).toBe(2);
	});

	it("decodes canonical entity references and rejects duplicate IDs within a page", () => {
		const prepared = Result.getOrThrow(
			entityBrowserRecipe({ settings: browserSettings, queryDocument: browserSource }),
		);
		const row = {
			__entityBrowserId: "item-1",
			__entityBrowserName: "Example",
			__entityBrowserSchemaSlug: "item",
			__entityBrowserOwnerPluginId: null,
			__entityBrowserTranslationStatus: { state: "queued", availability: "missing" },
			__entityBrowserPopulationStatus: { state: "succeeded", availability: "complete" },
		};
		const decoded = Result.getOrThrow(
			prepared.decode({ data: { entityBrowser: { pageInfo, type: "rows", items: [row] } } }),
		);
		expect(decoded).toEqual({
			pageInfo,
			items: [
				{
					cells: [],
					name: "Example",
					presentation: row,
					entityId: "item-1",
					ownerPluginId: null,
					entitySchemaSlug: "item",
					sync: {
						translationStatus: { state: "queued", availability: "missing" },
						populationStatus: { state: "succeeded", availability: "complete" },
					},
				},
			],
		});

		const duplicate = prepared.decode({
			data: { entityBrowser: { pageInfo, type: "rows", items: [row, row] } },
		});
		if (Result.isSuccess(duplicate)) {
			throw new Error("Expected duplicate entity IDs to fail");
		}
		expect(String(duplicate.failure)).toContain(
			"Entity-browser page contains duplicate entity ID 'item-1'",
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
						pageInfo,
						type: "rows",
						items: [
							{
								details: null,
								nameAlias: "Example",
								__entityBrowserId: "item-1",
								__entityBrowserName: "Example",
								__entityBrowserSchemaSlug: "item",
								__entityBrowserOwnerPluginId: null,
								__entityBrowserTranslationStatus: { state: "idle", availability: "none" },
								__entityBrowserPopulationStatus: { state: "succeeded", availability: "complete" },
							},
						],
					},
				},
			}),
		);

		expect(decoded.items[0]?.cells).toEqual([
			{ label: "Name", key: "nameAlias", value: { value: "Example", displayKind: "text" } },
			{ key: "details", label: "Details", value: { value: null, displayKind: "json" } },
		]);
	});

	it("counts distinct selected IDs without selection pagination", () => {
		const prepared = Result.getOrThrow(entityBrowserCountRecipe(browserSource, browserSettings));

		expect(prepared.document).toEqual({
			queries: {
				entityBrowserCount: {
					from: entity,
					where: itemPredicate,
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
		expect(query?.where).toEqual(
			and(itemPredicate, or(contains(castText(column(entity, "name")), literal("iran")))),
		);
	});

	it("constrains pages and counts to every subject schema when the source omits the schema predicate", () => {
		const settings = {
			...browserSettings,
			subject: {
				entityAlias: "entity",
				schemas: [
					{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("item") },
					{
						slug: EntitySchemaSlug.make("entry"),
						owner: { kind: "plugin", pluginId: PluginId.make("plugin-a") },
					},
				],
			},
		} as const;
		const expected = or(
			itemSchema,
			entitySchemaPredicate(entity, "entry", {
				kind: "local",
				pluginId: PluginId.make("plugin-a"),
			}),
		);
		const page = Result.getOrThrow(entityBrowserRecipe({ settings, queryDocument: browserSource }))
			.document.queries.entityBrowser;
		const count = Result.getOrThrow(entityBrowserCountRecipe(browserSource, settings)).document
			.queries.entityBrowserCount;

		expect(page?.where).toEqual(expected);
		expect(count?.where).toEqual(expected);
	});

	it("injects provenance projections under unused keys", () => {
		const taken = document({
			selection: rows(entity, {
				limit: 40,
				fields: [field("__entityBrowserId", column(entity, "name"))],
			}),
		});
		const query = Result.getOrThrow(
			entityBrowserRecipe({ queryDocument: taken, settings: browserSettings }),
		).document.queries.entityBrowser;

		expect(
			query?.output.type === "rows"
				? query.output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : []))
				: [],
		).toEqual([
			"__entityBrowserId",
			"___entityBrowserId",
			"__entityBrowserOwnerPluginId",
			"__entityBrowserSchemaSlug",
			"__entityBrowserName",
			"__entityBrowserPopulationStatus",
			"__entityBrowserTranslationStatus",
		]);
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
				{ label: "Year", field: "year", displayKind: "year" },
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
					field("year", literal(1995)),
					field("artwork", literal({ type: "local", key: "covers/item.webp" })),
				],
			}),
		});
		const storedSource = structuredClone(source);
		const prepared = Result.getOrThrow(
			resultsTableRecipe({ settings, queryDocument: source, after: "runtime-cursor" }),
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
								year: 1995,
								sequence: 1,
								variant: "1",
								amount: null,
								value: "First",
								entityId: "same",
								artwork: { type: "local", key: "covers/item.webp" },
							},
							{
								variant: 1,
								year: null,
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
			'[{"value":1,"type":"number"},{"value":"1","type":"string"}]',
			'[{"value":"1","type":"string"},{"value":1,"type":"number"}]',
		]);
		expect(decoded.items.map(({ entityId }) => entityId)).toEqual(["same", "same"]);
		expect(decoded.items[0]?.cells[1]?.value).toEqual({ value: null, displayKind: "number" });
		expect(decoded.items[0]?.cells[2]?.value).toEqual({
			displayKind: "managed-asset",
			value: { type: "local", key: "covers/item.webp" },
		});
		expect(decoded.items[0]?.cells[3]?.value).toEqual({ value: 1995, displayKind: "year" });
		expect(decoded.items[1]?.cells[3]?.value).toEqual({ value: null, displayKind: "year" });
		expect(decoded.items[1]?.cells[2]?.value).toEqual({
			value: null,
			displayKind: "managed-asset",
		});
	});

	it("rejects missing, null, and duplicate general result row keys", () => {
		const prepared = Result.getOrThrow(
			resultsTableRecipe({
				queryDocument: document({
					events: rows(entity, {
						fields: [field("key", column(entity, "id")), field("value", column(entity, "name"))],
					}),
				}),
				settings: {
					pageSize: 2,
					entityLink: null,
					sourceName: "events",
					rowKeyFields: ["key"],
					columns: [{ label: "Value", field: "value", displayKind: "text" }],
				},
			}),
		);
		const decode = (items: readonly Record<string, unknown>[]) =>
			prepared.decode({ data: { resultsTable: { items, pageInfo, type: "rows" } } });

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
