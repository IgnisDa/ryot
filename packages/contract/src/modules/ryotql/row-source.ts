import { ARGUMENT_NAME_PATTERN, keysMatch, Message } from "@ryot-app/i18n/message";
import { Result, Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import { ManifestText } from "../plugins/manifest-text";
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
} from "./authored";
import { OutputFieldKey } from "./language";

const rowText = <Text extends Schema.Top>(text: Text) =>
	strictStruct({
		text,
		params: Schema.Record(Schema.String, OutputFieldKey).check(
			keysMatch(ARGUMENT_NAME_PATTERN, "argument names"),
		),
	});

/**
 * A message whose arguments are bound, per row, from the named output fields. Queries yield codes
 * and numbers, never display text; the catalog turns codes into text through `select`.
 */
export const RowText = rowText(Message);
export type RowText = typeof RowText.Type;

/** Plugin-authored row text names manifest text from the plugin's catalog. */
export const AuthoredRowText = rowText(ManifestText);
export type AuthoredRowText = typeof AuthoredRowText.Type;

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
		[ROW_SOURCE_QUERY_NAME]: rowSourceNamedQuery(query, {
			orderBy: [],
			pagination: { limit: 1, maxLimit: 1 },
		}),
	},
});

export const mapRowSourceQueryReferences = (
	query: RowSourceQuery,
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
): RowSourceQuery => {
	const mapped = Result.getOrThrow(mapPluginIdentityReferences(rowSourceDocument(query), transform))
		.queries[ROW_SOURCE_QUERY_NAME];
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
