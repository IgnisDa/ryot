import { assert } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";

type StoredRow = Readonly<Record<string, string | null>>;
type Rows = Readonly<Record<string, StoredRow>>;
export type StoredTables = Readonly<Record<string, readonly StoredRow[]>>;

export const measurementTables: StoredTables = {
	entity: [
		{ id: "weight", entitySchemaPluginId: "fitness-owner", entitySchemaSlug: "measurement-metric" },
		{ id: "waist", entitySchemaPluginId: "fitness-owner", entitySchemaSlug: "measurement-metric" },
		{ id: "exercise-1", entitySchemaSlug: "exercise", entitySchemaPluginId: "fitness-owner" },
		{
			id: "library",
			userId: "user-1",
			entitySchemaSlug: "fitness-library",
			entitySchemaPluginId: "fitness-owner",
		},
	],
	event: [
		{
			id: "reading-1",
			entityId: "weight",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "reading-2",
			entityId: "waist",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "note-1",
			entityId: "exercise-1",
			eventSchemaSlug: "review",
			eventSchemaPluginId: "fitness-owner",
		},
		{
			id: "fake-reading",
			entityId: "exercise-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
	],
};

const evaluate = (expression: unknown, rows: Rows): unknown => {
	assert(typeof expression === "object" && expression !== null && "type" in expression);
	if (expression.type === "literal" && "value" in expression) {
		return expression.value;
	}
	if (expression.type === "pluginId") {
		return "fitness-owner";
	}
	if (expression.type === "column" && "tableAlias" in expression && "field" in expression) {
		assert(typeof expression.tableAlias === "string" && typeof expression.field === "string");
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "isNotNull" && "expr" in expression) {
		return evaluate(expression.expr, rows) !== undefined;
	}
	if (expression.type === "and" && "predicates" in expression) {
		assert(Array.isArray(expression.predicates));
		return expression.predicates.every((predicate) => evaluate(predicate, rows) === true);
	}
	if (expression.type === "in" && "expr" in expression && "values" in expression) {
		assert(Array.isArray(expression.values));
		const value = evaluate(expression.expr, rows);
		return expression.values.some((candidate) => evaluate(candidate, rows) === value);
	}
	if (
		expression.type === "comparison" &&
		"operator" in expression &&
		expression.operator === "eq" &&
		"left" in expression &&
		"right" in expression
	) {
		return evaluate(expression.left, rows) === evaluate(expression.right, rows);
	}
	throw new Error("Unsupported RyotQL expression");
};

export const inMemoryRyotql = (tables: StoredTables) => (document: RyotQLDocument) =>
	Effect.sync(() => {
		const [[key, query] = []] = Object.entries(document.queries);
		assert(key !== undefined && query?.output.type === "rows");
		const { output } = query;
		let rows: Rows[] = (tables[query.from.table] ?? []).map((row) => ({ [query.from.alias]: row }));
		for (const joined of query.joins ?? []) {
			assert(joined.type === "inner");
			rows = rows.flatMap((row) =>
				(tables[joined.table.table] ?? [])
					.map((candidate) => Object.assign({ [joined.table.alias]: candidate }, row))
					.filter((candidate) => evaluate(joined.on, candidate) === true),
			);
		}
		const items = rows
			.filter((row) => query.where === undefined || evaluate(query.where, row) === true)
			.map((row) =>
				Object.fromEntries(
					output.fields.map((selection) => {
						assert("key" in selection);
						return [selection.key, evaluate(selection.expr, row)];
					}),
				),
			)
			.slice(0, output.pagination.limit);
		return {
			data: {
				[key]: { items, type: "rows", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
			},
		};
	});

export const executeMeasurementRyotql = inMemoryRyotql(measurementTables);
