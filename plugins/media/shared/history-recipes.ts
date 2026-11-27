import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	conditional,
	defineRecipe,
	eq,
	eventOrderDescending,
	exists,
	first,
	literal,
	type NamedQuery,
	or,
	type RowsOutput,
	type ScalarExpression,
	selectedField,
	type SelectedQuery,
	selectedRows,
	type SelectedSelection,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import { mediaEntityParameters } from "./query-parameters";

type HistoryCategory<Event> = {
	readonly query: NamedQuery & { readonly output: RowsOutput };
	readonly decode: (row: Readonly<Record<string, unknown>>) => Result.Result<Event, unknown>;
};

export const historyCategory = <Row, Event>(
	query: SelectedQuery<
		{ readonly items: readonly Row[] },
		NamedQuery & { readonly output: RowsOutput }
	>,
	map: (row: Row) => Event,
): HistoryCategory<Event> => ({
	query: query.document,
	decode: (row) =>
		Result.flatMap(
			query.decodeResult({
				type: "rows",
				items: [row],
				pageInfo: { limit: 1, hasMore: false, nextCursor: null },
			}),
			({ items }) => {
				const item = items[0];
				return item === undefined
					? Result.fail(new Error("History category is missing its event"))
					: Result.succeed(map(item));
			},
		),
});

export const mediaEventHistoryRecipe = <Event>(categories: readonly HistoryCategory<Event>[]) => {
	const event = table("event", "history");
	const sources = categories.map((category, index) => {
		const query = category.query;
		const where = and(query.where ?? and(), eq(column(query.from, "id"), column(event, "id")));
		const scope = { ...(query.joins === undefined ? {} : { joins: query.joins }), where };
		return {
			index,
			category,
			matches: exists(query.from, scope),
			fields: query.output.fields.map((field) => {
				if ("type" in field) {
					throw new Error("History categories require explicit fields");
				}
				return {
					key: field.key,
					projection: selectedField(
						first(query.from, {
							...scope,
							select: field.expr,
							orderBy: eventOrderDescending(table("event", query.from.alias)),
						}),
						Schema.Unknown,
					),
				};
			}),
		};
	});
	const selection: SelectedSelection = {
		category: selectedField(
			sources.reduceRight<ScalarExpression>(
				(otherwise, source) =>
					conditional(source.matches, literal(String(source.index)), otherwise),
				literal("missing"),
			),
			Schema.String,
		),
		...Object.fromEntries(
			sources.flatMap((source) =>
				source.fields.map((field) => [`category${source.index}_${field.key}`, field.projection]),
			),
		),
	};

	return defineRecipe({
		parameters: mediaEntityParameters.schema,
		queries: {
			history: selectedRows(event, {
				selection,
				limit: 100,
				maxLimit: 100,
				orderBy: eventOrderDescending(event),
				where: or(...sources.map((source) => source.matches)),
			}),
		},
		map: ({ history }) =>
			Result.map(
				Result.all(
					history.items.map((row) => {
						const source = sources.find((candidate) => String(candidate.index) === row.category);
						if (source === undefined) {
							return Result.fail(new Error("History event has no matching category"));
						}
						return source.category.decode(
							Object.fromEntries(
								source.fields.map((field) => [
									field.key,
									row[`category${source.index}_${field.key}`],
								]),
							),
						);
					}),
				),
				(items) => ({ ...history, items }),
			),
	});
};
