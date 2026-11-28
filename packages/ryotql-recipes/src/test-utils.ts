import type { AuthoredSchemaText } from "@ryot-app/contract/modules/plugins/manifest-text";
import type * as Authored from "@ryot-app/contract/modules/ryotql/authored";
import type {
	NamedQuery,
	Predicate,
	RowsOutput,
	RowsResult,
	RyotQLDocument,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	type ExecutionRequest,
	type PluginExecutionRequest,
	QueryPage,
} from "@ryot-app/contract/modules/ryotql/request";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { type AppSchema, mapAppSchemaText } from "@ryot-app/contract/schema/property-schema";
import { type DisplayText, stampNamespace } from "@ryot-app/i18n/message";
import type { Recipe } from "@ryot-app/ryotql";
import { bindDocument, type BindingContext } from "@ryot-app/ryotql/binding";
import { Effect, Result, Schema } from "effect";

export const rowsResult = (items: readonly unknown[], pageInfo: RowsResult["pageInfo"]) => ({
	items,
	pageInfo,
	type: "rows" as const,
});

export const rowsResponse = (
	queryName: string,
	items: readonly unknown[],
	pageInfo: RowsResult["pageInfo"],
) => ({ data: { [queryName]: rowsResult(items, pageInfo) } });

type TestText = DisplayText | AuthoredSchemaText;
type TestDocument = Omit<Authored.RyotQLDocument, "parameters"> & {
	readonly parameters?: undefined | AppSchema<TestText>;
};
export function requireRowsQuery(
	query: undefined | Authored.NamedQuery,
): Authored.NamedQuery & { readonly output: Authored.RowsOutput };
export function requireRowsQuery(
	query: undefined | NamedQuery,
): NamedQuery & { readonly output: RowsOutput };
export function requireRowsQuery(query: undefined | NamedQuery | Authored.NamedQuery) {
	if (query?.output.type !== "rows") {
		throw new Error("Expected rows query");
	}
	return { ...query, output: query.output };
}

/** Stamps plugin-authored parameter text with a test namespace, as the receiving side would. */
const stampTestDocument = ({ parameters, ...document }: TestDocument): Authored.RyotQLDocument =>
	parameters === undefined
		? document
		: {
				...document,
				parameters: mapAppSchemaText(parameters, (text) =>
					typeof text === "string" || "namespace" in text ? text : stampNamespace("testing", text),
				),
			};

export const bindRecipe = <Success, Parameters extends AppSchema<TestText>>(
	recipe: Recipe<Success, Parameters>,
	input: Readonly<Record<string, unknown>> = {},
	context: BindingContext = {
		reportingTimeZone: "UTC",
		now: new Date("2026-01-01T00:00:00Z"),
		resolveSourceEntity: (_reference, alias) =>
			Result.succeed({ alias, table: "sourceEntity:testing" }),
	},
	requestValues: Omit<PluginExecutionRequest, "source" | "arguments"> = {},
) => {
	const argumentsValue = Result.getOrThrow(
		Schema.decodeUnknownResult(Schema.Record(Schema.String, JsonValue))(
			Object.fromEntries(
				Object.entries(input).filter(
					([key, value]) => value !== undefined && key in recipe.parameters.fields,
				),
			),
		),
	);
	const page = Result.getOrThrow(
		Schema.decodeResult(QueryPage)(
			Object.fromEntries(
				Object.entries(input).filter(
					([key, value]) => value !== undefined && (key === "limit" || key === "after"),
				),
			),
		),
	);
	const pages = Object.fromEntries(
		Object.entries(recipe.document.queries).flatMap(([key, query]) =>
			query.output.type === "rows" || query.output.groupBy !== undefined ? [[key, page]] : [],
		),
	);
	const bound = Result.getOrThrow(
		bindDocument(
			stampTestDocument(recipe.document),
			{ pages, ...requestValues, arguments: argumentsValue },
			context,
		),
	);
	return { ...recipe, document: bound.document };
};

export const requireInlineDocument = (
	request: Pick<ExecutionRequest | PluginExecutionRequest, "source">,
) => {
	if (request.source.kind !== "inline") {
		throw new Error("Expected an inline query source");
	}
	return request.source.document;
};

export const bindTestRequest = (
	request: undefined | ExecutionRequest | PluginExecutionRequest,
	context: BindingContext = {
		reportingTimeZone: "UTC",
		now: new Date("2026-01-01T00:00:00Z"),
		resolveSourceEntity: (_reference, alias) =>
			Result.succeed({ alias, table: "sourceEntity:testing" }),
	},
) => {
	if (request === undefined) {
		throw new Error("Expected an execution request");
	}
	return Result.getOrThrow(
		bindDocument(stampTestDocument(requireInlineDocument(request)), request, context),
	).document;
};

export const recipeResponse = (
	recipe: { readonly document: Pick<RyotQLDocument | Authored.RyotQLDocument, "queries"> },
	overrides: Readonly<Record<string, unknown>> = {},
) => {
	const data: Record<string, unknown> = {};
	const queries: Readonly<Record<string, NamedQuery | Authored.NamedQuery>> =
		recipe.document.queries;
	for (const [name, query] of Object.entries(queries)) {
		if (Object.hasOwn(overrides, name)) {
			data[name] = overrides[name];
		} else if (query.output.type === "rows") {
			data[name] = rowsResult([], {
				hasMore: false,
				nextCursor: null,
				limit: query.output.pagination.limit,
			});
		} else if (query.output.groupBy !== undefined && query.output.groupBy.length > 0) {
			data[name] = {
				items: [],
				type: "aggregate",
				pageInfo: { hasMore: false, nextCursor: null, limit: query.output.limit ?? 20 },
			};
		} else {
			throw new Error(`Supply an explicit aggregate result for '${name}'`);
		}
	}
	return { data: Object.assign(data, overrides) };
};

export type StoredTables = Readonly<Record<string, readonly StoredRow[]>>;
type StoredRow = Readonly<Record<string, unknown>>;
type JoinedRows = Readonly<Record<string, StoredRow>>;

const evaluate = (
	expression: Predicate | ScalarExpression,
	rows: JoinedRows,
	store: { readonly pluginId: string; readonly tables: StoredTables },
): unknown => {
	if (expression.type === "literal") {
		return expression.value;
	}
	if (expression.type === "pluginId") {
		if (expression.reference.kind === "package") {
			throw new Error("Unsupported package plugin reference");
		}
		return expression.reference.kind === "local" ? expression.reference.pluginId : store.pluginId;
	}
	if (expression.type === "cast") {
		return evaluate(expression.expr, rows, store);
	}
	if (expression.type === "jsonPath") {
		let value = evaluate(expression.expr, rows, store);
		for (const key of expression.path) {
			if (typeof value !== "object" || value === null) {
				throw new Error("Expected a JSON object along the path");
			}
			value = Object.entries(value).find(([name]) => name === String(key))?.[1];
		}
		return value;
	}
	if (expression.type === "aggregate") {
		const { from, where } = expression.query;
		return (store.tables[from.table] ?? []).filter(
			(row) =>
				where === undefined || evaluate(where, { ...rows, [from.alias]: row }, store) === true,
		).length;
	}
	if (expression.type === "column") {
		return rows[expression.tableAlias]?.[expression.field];
	}
	if (expression.type === "isNotNull") {
		return evaluate(expression.expr, rows, store) != null;
	}
	if (expression.type === "and") {
		return expression.predicates.every((predicate) => evaluate(predicate, rows, store) === true);
	}
	if (expression.type === "in") {
		const value = evaluate(expression.expr, rows, store);
		return expression.values.some((candidate) => evaluate(candidate, rows, store) === value);
	}
	if (expression.type === "comparison" && expression.operator === "eq") {
		return evaluate(expression.left, rows, store) === evaluate(expression.right, rows, store);
	}
	throw new Error(`Unsupported RyotQL expression '${expression.type}'`);
};

/**
 * Answers a request's single rows query from `tables`, keyed by catalog table name, with `pluginId`
 * as the requesting plugin. It evaluates inner joins, equality, `in`, `and`, null checks, JSON paths,
 * casts, and counting aggregates, and pages by row `id`; anything else throws.
 */
export const inMemoryRyotql =
	(store: { readonly pluginId: string; readonly tables: StoredTables }) =>
	(request: PluginExecutionRequest) =>
		Effect.sync(() => {
			const [[key, query] = []] = Object.entries(bindTestRequest(request).queries);
			if (key === undefined || query?.output.type !== "rows") {
				throw new Error("Expected a single rows query");
			}
			const { output } = query;
			let rows: JoinedRows[] = (store.tables[query.from.table] ?? []).map((row) => ({
				[query.from.alias]: row,
			}));
			for (const joined of query.joins ?? []) {
				if (joined.type !== "inner") {
					throw new Error(`Unsupported RyotQL join '${joined.type}'`);
				}
				rows = rows.flatMap((row) =>
					(store.tables[joined.table.table] ?? [])
						.map((candidate) => Object.assign({ [joined.table.alias]: candidate }, row))
						.filter((candidate) => evaluate(joined.on, candidate, store) === true),
				);
			}
			const matches = rows
				.filter((row) => query.where === undefined || evaluate(query.where, row, store) === true)
				.map((row) =>
					Object.fromEntries(
						output.fields.map((selection) => {
							if (!("key" in selection)) {
								throw new Error("Unsupported RyotQL selection");
							}
							return [selection.key, evaluate(selection.expr, row, store)];
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
