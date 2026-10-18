import { assert } from "@effect/vitest";
import type {
	Predicate,
	RyotQLDocument,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export type StoredTables = Readonly<Record<string, readonly StoredRow[]>>;
type Expression = Predicate | ScalarExpression;
type Rows = Readonly<Record<string, StoredRow>>;
type StoredRow = Readonly<Record<string, unknown>>;

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

const evaluate = (expression: Expression, rows: Rows, tables: StoredTables): unknown => {
	if (expression.type === "literal") {
		return expression.value;
	}
	if (expression.type === "pluginId") {
		return "fitness-owner";
	}
	if (expression.type === "cast") {
		return evaluate(expression.expr, rows, tables);
	}
	if (expression.type === "jsonPath") {
		let value = evaluate(expression.expr, rows, tables);
		for (const key of expression.path) {
			assert(typeof value === "object" && value !== null);
			value = Object.entries(value).find(([name]) => name === String(key))?.[1];
		}
		return value;
	}
	if (expression.type === "aggregate") {
		const { from, where } = expression.query;
		return (tables[from.table] ?? []).filter(
			(row) =>
				where === undefined || evaluate(where, { ...rows, [from.alias]: row }, tables) === true,
		).length;
	}
	if (expression.type === "column") {
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "isNotNull") {
		return evaluate(expression.expr, rows, tables) != null;
	}
	if (expression.type === "and") {
		return expression.predicates.every((predicate) => evaluate(predicate, rows, tables) === true);
	}
	if (expression.type === "in") {
		const value = evaluate(expression.expr, rows, tables);
		return expression.values.some((candidate) => evaluate(candidate, rows, tables) === value);
	}
	if (expression.type === "comparison" && expression.operator === "eq") {
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
