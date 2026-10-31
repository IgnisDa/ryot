import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import type { PluginIdentityReference } from "../plugins/references";
import {
	Include,
	Join,
	mapPluginIdentityReferences,
	type NamedQuery,
	Predicate,
	RowSelection,
	type RowsOutput,
	type RyotQLDocument,
	TableReference,
} from "./language";

export const RowSourcePrecision = Schema.Literals(["date", "instant"]);
export type RowSourcePrecision = typeof RowSourcePrecision.Type;

export const RowSourceQuery = strictStruct({
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.NonEmptyArray(Join)),
	output: strictStruct({
		type: Schema.Literal("rows"),
		fields: Schema.Array(RowSelection),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
	}),
});
export type RowSourceQuery = typeof RowSourceQuery.Type;

const ROW_SOURCE_QUERY_NAME = "source";

export const rowSourceNamedQuery = (
	query: RowSourceQuery,
	output: Pick<RowsOutput, "orderBy" | "pagination">,
): NamedQuery => ({ ...query, output: { ...query.output, ...output } });

export const rowSourceDocument = (query: RowSourceQuery): RyotQLDocument => ({
	queries: {
		[ROW_SOURCE_QUERY_NAME]: rowSourceNamedQuery(query, { orderBy: [], pagination: { limit: 1 } }),
	},
});

export const mapRowSourceQueryReferences = (
	query: RowSourceQuery,
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
): RowSourceQuery => {
	const mapped = mapPluginIdentityReferences(rowSourceDocument(query), transform).queries[
		ROW_SOURCE_QUERY_NAME
	];
	if (mapped?.output.type !== "rows") {
		throw new Error("Row source query mapping must preserve its rows output");
	}
	const { orderBy: _orderBy, pagination: _pagination, ...output } = mapped.output;
	return { ...mapped, output };
};

export const rowSourceProjectedKeys = (query: RowSourceQuery) =>
	new Set(query.output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : [])));

export const rowSourceAliases = (query: RowSourceQuery) =>
	new Set([
		query.from.alias,
		...(query.joins ?? []).map((join) =>
			join.type === "jsonElements" ? join.alias : join.table.alias,
		),
	]);
