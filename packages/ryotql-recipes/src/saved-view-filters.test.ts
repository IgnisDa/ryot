import type { Filter, FilterField } from "@ryot-app/contract/modules/saved-views/filters";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	contains,
	document,
	eq,
	exists,
	field,
	gte,
	inArray,
	isNotNull,
	isNull,
	jsonArrayExists,
	jsonElement,
	jsonPath,
	literal,
	lte,
	not,
	or,
	relationshipSchemaPredicate,
	rows,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { compileFilter, effectiveFilterFields } from "./saved-view-filters";
import { entityBrowserCountRecipe, entityBrowserRecipe, resultsTableRecipe } from "./saved-views";
import { requireRowsQuery } from "./test-utils";

const entity = table("entity", "entity");
const properties = column(entity, "properties");
const subject = {
	entityAlias: "entity",
	schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("book") }],
} as const;

const source = requireRowsQuery(
	document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			fields: [
				field("name", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
				field("muscles", jsonPath(properties, "muscles")),
				field("genres", jsonPath(properties, "genres")),
				field("reps", jsonPath(properties, "reps")),
				field("done", jsonPath(properties, "done")),
				field("added", column(entity, "createdAt")),
			],
		}),
	}).queries.selection,
);

const valueField = (
	key: string,
	type: "enum" | "enum-list" | "text" | "text-list" | "number" | "date" | "boolean",
): FilterField =>
	type === "enum" || type === "enum-list"
		? { key, type, label: key, field: key, kind: "value", choices: [{ value: "a", label: "A" }] }
		: { key, type, label: key, field: key, kind: "value" };

const fields: readonly FilterField[] = [
	valueField("name", "text"),
	valueField("level", "enum"),
	valueField("muscles", "enum-list"),
	valueField("genres", "text-list"),
	valueField("reps", "number"),
	valueField("done", "boolean"),
	valueField("added", "date"),
	...effectiveFilterFields("entity-browser", {}),
];

let now: DateTime.Utc;

beforeAll(() =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const clock = yield* TestClock.make();
				yield* clock.setTime(Date.parse("2026-03-10T12:00:00.000Z"));
				now = DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());
			}),
		),
	),
);

const compile = (filter: Filter, override: Partial<Parameters<typeof compileFilter>[0]> = {}) =>
	compileFilter({ now, source, fields, filter, subject, ...override });

const compiled = (filter: Filter) => Result.getOrThrow(compile(filter));

const effectiveCollections = () => {
	const collections = effectiveFilterFields("entity-browser", {}).find(
		({ key }) => key === "collections",
	);
	if (collections?.kind !== "relationship") {
		throw new Error("Expected the kernel collections field");
	}
	return collections;
};

const element = castText(jsonElement());
const text = (key: string) => castText(jsonPath(properties, key));

const linked = (alias: string, ids: readonly string[]) => {
	const rel = table("relationship", alias);
	return exists(rel, {
		where: and(
			relationshipSchemaPredicate(rel, "member-of", { kind: "kernel" }),
			eq(column(rel, "sourceEntityId"), column(entity, "id")),
			...(ids.length === 0
				? []
				: [
						inArray(
							column(rel, "targetEntityId"),
							ids.map((id) => literal(id)),
						),
					]),
		),
	});
};

describe("filter compiler", () => {
	it("casts scalar operands to the kind of their literals", () => {
		const level = jsonPath(properties, "level");
		expect(compiled({ field: "level", operator: "anyOf", values: ["a", "b"] })).toEqual(
			inArray(text("level"), [literal("a"), literal("b")]),
		);
		expect(compiled({ values: ["a"], field: "level", operator: "noneOf" })).toEqual(
			or(isNull(level), not(inArray(text("level"), [literal("a")]))),
		);
		expect(compiled({ field: "level", operator: "empty" })).toEqual(isNull(level));
		expect(compiled({ field: "level", operator: "notEmpty" })).toEqual(isNotNull(level));
		expect(compiled({ value: "sq", field: "name", operator: "contains" })).toEqual(
			contains(castText(column(entity, "name")), literal("sq")),
		);
		expect(compiled({ field: "name", operator: "is", value: "Squat" })).toEqual(
			eq(castText(column(entity, "name")), literal("Squat")),
		);
		expect(compiled({ min: 3, max: 8, field: "reps", operator: "between" })).toEqual(
			and(
				gte(castNumber(jsonPath(properties, "reps")), literal(3)),
				lte(castNumber(jsonPath(properties, "reps")), literal(8)),
			),
		);
		expect(compiled({ field: "done", operator: "isFalse" })).toEqual(
			eq(castBoolean(jsonPath(properties, "done")), literal(false)),
		);
		expect(
			compiled({ field: "added", to: "2026-02-01", from: "2026-01-01", operator: "betweenDates" }),
		).toEqual(
			and(
				gte(castDate(column(entity, "createdAt")), castDate(literal("2026-01-01"))),
				lte(castDate(column(entity, "createdAt")), castDate(literal("2026-02-01"))),
			),
		);
	});

	it("derives withinLastDays from the supplied now", () => {
		expect(compiled({ days: 7, field: "added", operator: "withinLastDays" })).toEqual(
			gte(castDate(column(entity, "createdAt")), castDate(literal("2026-03-03T12:00:00.000Z"))),
		);
	});

	it("matches list fields element-wise and includes nulls for noneOf and empty", () => {
		const muscles = jsonPath(properties, "muscles");
		expect(compiled({ field: "muscles", operator: "anyOf", values: ["a", "b"] })).toEqual(
			jsonArrayExists(muscles, inArray(element, [literal("a"), literal("b")])),
		);
		expect(compiled({ field: "muscles", operator: "allOf", values: ["a", "b"] })).toEqual(
			and(
				jsonArrayExists(muscles, eq(element, literal("a"))),
				jsonArrayExists(muscles, eq(element, literal("b"))),
			),
		);
		expect(compiled({ values: ["a"], field: "muscles", operator: "noneOf" })).toEqual(
			not(jsonArrayExists(muscles, inArray(element, [literal("a")]))),
		);
		expect(compiled({ field: "muscles", operator: "empty" })).toEqual(
			or(isNull(muscles), not(jsonArrayExists(muscles))),
		);
		expect(compiled({ field: "muscles", operator: "notEmpty" })).toEqual(jsonArrayExists(muscles));
		expect(compiled({ value: "dra", field: "genres", operator: "contains" })).toEqual(
			jsonArrayExists(jsonPath(properties, "genres"), contains(element, literal("dra"))),
		);
	});

	it("nests and, or and not and drops empty groups", () => {
		const level: Filter = { field: "level", operator: "empty" };
		const reps: Filter = { value: 5, field: "reps", operator: "eq" };
		expect(
			compiled({
				type: "and",
				filters: [
					level,
					{
						type: "or",
						filters: [
							{ type: "not", filter: reps },
							{ type: "and", filters: [] },
						],
					},
				],
			}),
		).toEqual(
			and(
				isNull(jsonPath(properties, "level")),
				or(not(eq(castNumber(jsonPath(properties, "reps")), literal(5)))),
			),
		);
		expect(Result.getOrThrow(compile({ type: "or", filters: [] }))).toBeUndefined();
		expect(
			Result.getOrThrow(compile({ type: "not", filter: { type: "and", filters: [] } })),
		).toBeUndefined();
	});

	it("compiles relationship fields to correlated exists on unused aliases", () => {
		expect(compiled({ operator: "anyOf", field: "collections", values: ["c1", "c2"] })).toEqual(
			linked("relationship", ["c1", "c2"]),
		);
		expect(compiled({ values: ["c1"], operator: "noneOf", field: "collections" })).toEqual(
			not(linked("relationship", ["c1"])),
		);
		expect(compiled({ field: "collections", operator: "notEmpty" })).toEqual(
			linked("relationship", []),
		);
		expect(compiled({ operator: "empty", field: "collections" })).toEqual(
			not(linked("relationship", [])),
		);
		expect(compiled({ operator: "allOf", field: "collections", values: ["c1", "c2"] })).toEqual(
			and(linked("relationship", ["c1"]), linked("_relationship", ["c2"])),
		);
		const crowded = requireRowsQuery({
			...source,
			joins: [
				{
					type: "left",
					on: eq(literal(1), literal(1)),
					table: table("relationship", "relationship"),
				},
			],
		});
		expect(
			Result.getOrThrow(
				compile({ values: ["c1"], operator: "anyOf", field: "collections" }, { source: crowded }),
			),
		).toEqual(linked("_relationship", ["c1"]));
		const incoming: FilterField = {
			key: "parents",
			label: "Parents",
			kind: "relationship",
			direction: "incoming",
			relationship: effectiveCollections().relationship,
		};
		const result = Result.getOrThrow(
			compile({ field: "parents", operator: "notEmpty" }, { fields: [incoming] }),
		);
		expect(JSON.stringify(result)).toContain('"field":"targetEntityId"');
	});

	it("fails for unknown fields, disallowed operators and relationship fields without a subject", () => {
		for (const filter of [
			{ field: "missing", operator: "empty" },
			{ value: "a", field: "level", operator: "contains" },
			{ field: "genres", operator: "empty" },
			{ field: "done", operator: "empty" },
			{ value: "a", field: "collections", operator: "contains" },
			{ min: 9, max: 1, field: "reps", operator: "between" },
			{ type: "and", filters: [{ field: "missing", operator: "empty" }] },
		] satisfies Filter[]) {
			expect(Result.isFailure(compile(filter))).toBe(true);
		}
		expect(
			Result.isFailure(
				compile({ field: "collections", operator: "notEmpty" }, { subject: undefined }),
			),
		).toBe(true);
	});
});

describe("effective filter fields", () => {
	it("adds the kernel Collections field to entity and collection browsers only", () => {
		const authored = [valueField("level", "enum")];
		expect(effectiveFilterFields("entity-browser", { filterFields: authored })).toEqual([
			...authored,
			effectiveCollections(),
		]);
		expect(effectiveFilterFields("collection-browser", {}).map(({ key }) => key)).toEqual([
			"collections",
		]);
		expect(effectiveFilterFields("results-table", { filterFields: authored })).toEqual(authored);
		expect(effectiveCollections().relationship).toEqual({
			slug: "member-of",
			owner: { kind: "kernel" },
		});
	});
});

describe("filtered recipes", () => {
	const settings = {
		subject,
		pageSize: 5,
		addAction: null,
		sortChoices: [],
		layouts: ["grid"],
		tableColumns: null,
		defaultLayout: "grid",
		searchFields: ["name"],
		sourceName: "selection",
		filterFields: [valueField("level", "enum")],
	} as const;
	const queryDocument = document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			fields: [
				field("name", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
			],
		}),
	});
	const filter: Filter = {
		type: "and",
		filters: [
			{ values: ["a"], field: "level", operator: "anyOf" },
			{ values: ["c1"], operator: "anyOf", field: "collections" },
		],
	};

	it("applies the same predicate to pages and counts", () => {
		const input = { now, filter, settings, queryDocument, searchText: "x" };
		const page = Result.getOrThrow(entityBrowserRecipe(input)).document.queries.entityBrowser;
		const count = Result.getOrThrow(
			entityBrowserCountRecipe(queryDocument, settings, { now, filter, searchText: "x" }),
		).document.queries.entityBrowserCount;
		if (page?.output.type !== "rows" || count?.output.type !== "aggregate") {
			throw new Error("Expected rows and aggregate queries");
		}
		expect(count.where).toEqual(page.where);
		expect(JSON.stringify(page.where)).toContain('"type":"exists"');
	});

	it("rejects unknown filter fields for the browser and results-table recipes", () => {
		expect(
			Result.isFailure(
				entityBrowserRecipe({
					now,
					settings,
					queryDocument,
					filter: { field: "missing", operator: "empty" },
				}),
			),
		).toBe(true);
		const tableSettings = {
			pageSize: 5,
			entityLink: null,
			rowKeyFields: ["name"],
			sourceName: "selection",
			filterFields: settings.filterFields,
			columns: [{ label: "Name", field: "name", displayKind: "text" }],
		} as const;
		const filtered = Result.getOrThrow(
			resultsTableRecipe({
				now,
				queryDocument,
				settings: tableSettings,
				filter: { field: "level", operator: "empty" },
			}),
		).document.queries.resultsTable;
		expect(filtered?.where).toEqual(isNull(jsonPath(properties, "level")));
		expect(
			Result.isFailure(
				resultsTableRecipe({
					now,
					queryDocument,
					settings: tableSettings,
					filter: { field: "collections", operator: "notEmpty" },
				}),
			),
		).toBe(true);
	});
});
