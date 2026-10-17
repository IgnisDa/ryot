import type { Filter, FilterField } from "@ryot-app/contract/modules/filters/schemas";
import { EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, join, jsonPath, rows, table } from "@ryot-app/ryotql";
import { entityBrowserRecipe, resultsTableRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { DateTime, Result } from "effect";
import { expect, it } from "vitest";

import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const entity = table("entity", "entity");
const properties = column(entity, "properties");
const now = DateTime.makeUnsafe("2026-03-10T12:00:00.000Z");

const valueField = (
	key: string,
	type: "enum" | "enum-list" | "text" | "text-list" | "number" | "date" | "boolean",
): FilterField =>
	type === "enum" || type === "enum-list"
		? { key, type, label: key, field: key, kind: "value", choices: [{ value: "a", label: "A" }] }
		: { key, type, label: key, field: key, kind: "value" };

const filterFields = [
	valueField("name", "text"),
	valueField("level", "enum"),
	valueField("muscles", "enum-list"),
	valueField("genres", "text-list"),
	valueField("reps", "number"),
	valueField("done", "boolean"),
	valueField("added", "date"),
	valueField("released", "date"),
	{
		key: "exercises",
		label: "Exercises",
		kind: "session-event",
		event: {
			owner: { kind: "kernel" },
			slug: EventSchemaSlug.make("workout-set"),
			entitySchemaSlug: EntitySchemaSlug.make("exercise"),
		},
	},
] satisfies readonly FilterField[];

const selection = (extraJoins: readonly ReturnType<typeof join>[] = []) =>
	document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			...(extraJoins.length > 0 ? { joins: extraJoins } : {}),
			fields: [
				field("name", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
				field("muscles", jsonPath(properties, "muscles")),
				field("genres", jsonPath(properties, "genres")),
				field("reps", jsonPath(properties, "reps")),
				field("done", jsonPath(properties, "done")),
				field("added", column(entity, "createdAt")),
				field("released", jsonPath(properties, "released")),
			],
		}),
	});

const settings = {
	filterFields,
	pageSize: 10,
	addAction: null,
	sortChoices: [],
	searchFields: [],
	layouts: ["grid"],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "selection",
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("book") }],
	},
} as const;

const issue = (filter: Filter, queryDocument = selection()) =>
	validateRyotQLDocument(
		Result.getOrThrow(entityBrowserRecipe({ now, filter, settings, queryDocument })).document,
		savedViewDataSourceAccess,
	);

const operatorFamilies: readonly Filter[] = [
	{ field: "level", operator: "anyOf", values: ["a", "b"] },
	{ values: ["a"], field: "level", operator: "noneOf" },
	{ field: "level", operator: "empty" },
	{ field: "level", operator: "notEmpty" },
	{ value: "sq", field: "name", operator: "contains" },
	{ value: "sq", field: "name", operator: "notContains" },
	{ field: "name", operator: "is", value: "Squat" },
	{ value: 3, field: "reps", operator: "gte" },
	{ value: 3, field: "reps", operator: "lte" },
	{ value: 3, field: "reps", operator: "eq" },
	{ min: 1, max: 5, field: "reps", operator: "between" },
	{ field: "done", operator: "isTrue" },
	{ field: "done", operator: "isFalse" },
	{ field: "added", operator: "before", value: "2026-01-01" },
	{ field: "added", operator: "after", value: "2026-01-01" },
	{ field: "added", to: "2026-02-01", from: "2026-01-01", operator: "betweenDates" },
	{ days: 30, field: "added", operator: "withinLastDays" },
	{ days: 30, field: "released", operator: "withinLastDays" },
	{ field: "released", operator: "after", value: "2026-01-01" },
	{ field: "muscles", operator: "anyOf", values: ["a", "b"] },
	{ field: "muscles", operator: "allOf", values: ["a", "b"] },
	{ values: ["a"], field: "muscles", operator: "noneOf" },
	{ field: "muscles", operator: "empty" },
	{ field: "muscles", operator: "notEmpty" },
	{ value: "dra", field: "genres", operator: "contains" },
	{ operator: "anyOf", field: "collections", values: ["c1", "c2"] },
	{ operator: "allOf", field: "collections", values: ["c1", "c2"] },
	{ values: ["c1"], operator: "noneOf", field: "collections" },
	{ operator: "empty", field: "collections" },
	{ field: "collections", operator: "notEmpty" },
	{ operator: "anyOf", field: "exercises", values: ["e1", "e2"] },
	{ operator: "allOf", field: "exercises", values: ["e1", "e2"] },
	{ values: ["e1"], operator: "noneOf", field: "exercises" },
	{ operator: "empty", field: "exercises" },
	{ field: "exercises", operator: "notEmpty" },
];

it("compiles every operator family into a document the RyotQL validator accepts", () => {
	for (const filter of operatorFamilies) {
		expect(issue(filter), JSON.stringify(filter)).toBeNull();
	}
});

it("validates nested filters", () => {
	expect(
		issue({
			type: "and",
			filters: [
				{ type: "not", filter: { values: ["a"], field: "level", operator: "anyOf" } },
				{
					type: "or",
					filters: [
						{ values: ["c1"], operator: "anyOf", field: "collections" },
						{ field: "muscles", operator: "notEmpty" },
					],
				},
			],
		}),
	).toBeNull();
});

it("validates a relationship filter on a source that already uses the relationship alias", () => {
	const relationship = table("relationship", "relationship");
	const crowded = selection([
		join("left", relationship, eq(column(relationship, "sourceEntityId"), column(entity, "id"))),
	]);
	expect(issue({ values: ["c1"], operator: "anyOf", field: "collections" }, crowded)).toBeNull();
	expect(
		issue(
			{
				type: "and",
				filters: [
					{ values: ["c1"], operator: "anyOf", field: "collections" },
					{ operator: "allOf", field: "collections", values: ["c2", "c3"] },
				],
			},
			crowded,
		),
	).toBeNull();
});

it("applies value filters to results tables and rejects the Collections field there", () => {
	const tableSettings = {
		filterFields,
		pageSize: 10,
		entityLink: null,
		rowKeyFields: ["name"],
		sourceName: "selection",
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	} as const;
	const prepared = resultsTableRecipe({
		now,
		settings: tableSettings,
		queryDocument: selection(),
		filter: { days: 7, field: "added", operator: "withinLastDays" },
	});
	expect(
		validateRyotQLDocument(Result.getOrThrow(prepared).document, savedViewDataSourceAccess),
	).toBeNull();
	expect(
		Result.isFailure(
			resultsTableRecipe({
				now,
				settings: tableSettings,
				queryDocument: selection(),
				filter: { field: "collections", operator: "notEmpty" },
			}),
		),
	).toBe(true);
	expect(
		Result.isFailure(
			resultsTableRecipe({
				now,
				settings: tableSettings,
				queryDocument: selection(),
				filter: { field: "exercises", operator: "notEmpty" },
			}),
		),
	).toBe(true);
});
