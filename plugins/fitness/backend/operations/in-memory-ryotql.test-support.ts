import { assert } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";

type StoredRow = Readonly<Record<string, unknown>>;
type Rows = Readonly<Record<string, StoredRow>>;
export type StoredTables = Readonly<Record<string, readonly StoredRow[]>>;

export const measurementTables: StoredTables = {
	event: [
		{
			id: "reading-1",
			entityId: "weight",
			properties: { value: 70 },
			sessionEntityId: "entry-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "reading-2",
			entityId: "waist",
			properties: { value: 80 },
			sessionEntityId: "entry-1",
			eventSchemaPluginId: "fitness-owner",
			eventSchemaSlug: "measurement-reading",
		},
		{
			id: "reading-3",
			entityId: "weight",
			properties: { value: 72 },
			sessionEntityId: "entry-2",
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
	entity: [
		{
			id: "entry-1",
			userId: "user-1",
			name: "Measurement",
			entitySchemaPluginId: "fitness-owner",
			entitySchemaSlug: "measurement-entry",
			updatedAt: "2026-04-27T08:00:00.000Z",
			properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
		},
		{
			id: "entry-2",
			userId: "user-1",
			name: "Measurement",
			entitySchemaPluginId: "fitness-owner",
			entitySchemaSlug: "measurement-entry",
			updatedAt: "2026-04-27T08:00:00.000Z",
			properties: { occurredAt: "2026-04-27T08:00:00.000Z" },
		},
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
};

const evaluate = (expression: unknown, rows: Rows, tables: StoredTables): unknown => {
	assert(typeof expression === "object" && expression !== null && "type" in expression);
	if (expression.type === "literal" && "value" in expression) {
		return expression.value;
	}
	if (expression.type === "pluginId") {
		return "fitness-owner";
	}
	if (expression.type === "cast" && "expr" in expression) {
		return evaluate(expression.expr, rows, tables);
	}
	if (expression.type === "jsonPath" && "expr" in expression && "path" in expression) {
		assert(Array.isArray(expression.path));
		let value = evaluate(expression.expr, rows, tables);
		for (const key of expression.path) {
			assert(typeof key === "string");
			assert(typeof value === "object" && value !== null);
			value = Object.entries(value).find(([name]) => name === key)?.[1];
		}
		return value;
	}
	if (expression.type === "aggregate" && "query" in expression) {
		const query = expression.query;
		assert(typeof query === "object" && query !== null && "from" in query && "where" in query);
		const from = query.from;
		assert(typeof from === "object" && from !== null && "table" in from && "alias" in from);
		assert(typeof from.table === "string" && typeof from.alias === "string");
		const alias = from.alias;
		return (tables[from.table] ?? []).filter(
			(row) => evaluate(query.where, { ...rows, [alias]: row }, tables) === true,
		).length;
	}
	if (expression.type === "column" && "tableAlias" in expression && "field" in expression) {
		assert(typeof expression.tableAlias === "string" && typeof expression.field === "string");
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "isNotNull" && "expr" in expression) {
		return evaluate(expression.expr, rows, tables) != null;
	}
	if (expression.type === "and" && "predicates" in expression) {
		assert(Array.isArray(expression.predicates));
		return expression.predicates.every((predicate) => evaluate(predicate, rows, tables) === true);
	}
	if (expression.type === "in" && "expr" in expression && "values" in expression) {
		assert(Array.isArray(expression.values));
		const value = evaluate(expression.expr, rows, tables);
		return expression.values.some((candidate) => evaluate(candidate, rows, tables) === value);
	}
	if (
		expression.type === "comparison" &&
		"operator" in expression &&
		expression.operator === "eq" &&
		"left" in expression &&
		"right" in expression
	) {
		return evaluate(expression.left, rows, tables) === evaluate(expression.right, rows, tables);
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
					.filter((candidate) => evaluate(joined.on, candidate, tables) === true),
			);
		}
		const matches = rows
			.filter((row) => query.where === undefined || evaluate(query.where, row, tables) === true)
			.map((row) =>
				Object.fromEntries(
					output.fields.map((selection) => {
						assert("key" in selection);
						return [selection.key, evaluate(selection.expr, row, tables)];
					}),
				),
			);
		const offset =
			output.pagination.after === undefined
				? 0
				: matches.findIndex(({ id }) => id === output.pagination.after) + 1;
		const items = matches.slice(offset, offset + output.pagination.limit);
		const hasMore = offset + items.length < matches.length;
		return {
			data: {
				[key]: {
					items,
					type: "rows",
					pageInfo: {
						hasMore,
						limit: output.pagination.limit,
						nextCursor: hasMore ? items.at(-1)?.id : null,
					},
				},
			},
		};
	});

export const executeMeasurementRyotql = inMemoryRyotql(measurementTables);
