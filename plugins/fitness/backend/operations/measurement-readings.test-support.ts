import { assert } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/sandbox-sdk/ryotql";

type StoredRow = Readonly<Record<string, string>>;
type Rows = Readonly<Record<string, StoredRow>>;

const measurementTables: Readonly<Record<string, readonly StoredRow[]>> = {
	entity: [
		{ id: "weight", entitySchemaSlug: "measurement-metric" },
		{ id: "waist", entitySchemaSlug: "measurement-metric" },
		{ id: "exercise-1", entitySchemaSlug: "exercise" },
	],
	event: [
		{ id: "reading-1", entityId: "weight", eventSchemaSlug: "measurement-reading" },
		{ id: "reading-2", entityId: "waist", eventSchemaSlug: "measurement-reading" },
		{ id: "note-1", entityId: "exercise-1", eventSchemaSlug: "review" },
		{ id: "fake-reading", entityId: "exercise-1", eventSchemaSlug: "measurement-reading" },
	],
};

const evaluate = (expression: unknown, rows: Rows): unknown => {
	assert(typeof expression === "object" && expression !== null && "type" in expression);
	if (expression.type === "literal" && "value" in expression) {
		return expression.value;
	}
	if (expression.type === "column" && "tableAlias" in expression && "field" in expression) {
		assert(typeof expression.tableAlias === "string" && typeof expression.field === "string");
		return rows[expression.tableAlias]?.[expression.field];
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

export const executeMeasurementRyotql = (document: RyotQLDocument) =>
	Effect.sync(() => {
		const [[key, query] = []] = Object.entries(document.queries);
		assert(key !== undefined && query?.output.type === "rows");
		const { output } = query;
		let rows: Rows[] = (measurementTables[query.from.table] ?? []).map((row) => ({
			[query.from.alias]: row,
		}));
		for (const joined of query.joins ?? []) {
			assert(joined.type === "inner");
			rows = rows.flatMap((row) =>
				(measurementTables[joined.table.table] ?? [])
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
			);
		return {
			data: {
				[key]: { items, type: "rows", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
			},
		};
	});
