import type * as Authored from "@ryot-app/contract/modules/ryotql/authored";
import type {
	NamedQuery,
	RowsOutput,
	RowsResult,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import { type ExecutionRequest, QueryPage } from "@ryot-app/contract/modules/ryotql/request";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import { bindDocument, type BindingContext } from "@ryot-app/ryotql/binding";
import { Result, Schema } from "effect";

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

export const bindRecipe = <Success, Parameters extends AppSchema>(
	recipe: Recipe<Success, Parameters>,
	input: Readonly<Record<string, unknown>> = {},
	context: BindingContext = {
		reportingTimeZone: "UTC",
		now: new Date("2026-01-01T00:00:00Z"),
		resolveSourceEntity: (_reference, alias) =>
			Result.succeed({ alias, table: "sourceEntity:testing" }),
	},
	requestValues: Omit<ExecutionRequest, "source" | "arguments"> = {},
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
		bindDocument(recipe.document, { pages, ...requestValues, arguments: argumentsValue }, context),
	);
	return { ...recipe, document: bound.document };
};

export const requireInlineDocument = (request: Pick<ExecutionRequest, "source">) => {
	if (request.source.kind !== "inline") {
		throw new Error("Expected an inline query source");
	}
	return request.source.document;
};

export const bindTestRequest = (
	request: undefined | ExecutionRequest,
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
	return Result.getOrThrow(bindDocument(requireInlineDocument(request), request, context)).document;
};

export const recipeResponse = (
	recipe: { readonly document: RyotQLDocument | Authored.RyotQLDocument },
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
