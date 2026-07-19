import {
	JsonFieldValue,
	NullFieldValue,
	RowsPageInfo,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const nullableJsonFieldValue = Schema.Union([JsonFieldValue, NullFieldValue]);

const providerSearchWire = strictStruct({
	providerId: TextFieldValue,
	providerSlug: TextFieldValue,
	providerName: TextFieldValue,
	rootEntitySchemaSlug: TextFieldValue,
	searchOptionsSchema: nullableJsonFieldValue,
});

const providerSearchResponse = strictStruct({
	data: strictStruct({ providers: rowsResultSchema(providerSearchWire) }),
});

export const ProviderSearchSummary = strictStruct({
	providerSlug: Schema.String,
	providerName: Schema.String,
	providerId: SandboxProviderId,
	rootEntitySchemaSlug: EntitySchemaSlug,
	searchOptionsSchema: Schema.NullOr(AppSchema),
});
export type ProviderSearchSummary = typeof ProviderSearchSummary.Type;

export const ProviderSearchList = strictStruct({
	pageInfo: RowsPageInfo,
	items: Schema.Array(ProviderSearchSummary),
});
export type ProviderSearchList = typeof ProviderSearchList.Type;

const decodeProviderSearch = (row: typeof providerSearchWire.Type) =>
	Result.flatMap(
		row.searchOptionsSchema.kind === "null"
			? Result.succeed(null)
			: Schema.decodeUnknownResult(AppSchema)(row.searchOptionsSchema.value),
		(searchOptionsSchema) =>
			Result.succeed({
				searchOptionsSchema,
				providerSlug: row.providerSlug.value,
				providerName: row.providerName.value,
				providerId: SandboxProviderId.make(row.providerId.value),
				rootEntitySchemaSlug: EntitySchemaSlug.make(row.rootEntitySchemaSlug.value),
			} satisfies ProviderSearchSummary),
	);

export const buildProviderSearchDocument = (input: {
	readonly rootEntitySchemaSlug: EntitySchemaSlug;
}) => {
	const provider = table("sandboxProvider", "provider");
	const operation = table("sandboxProviderOperation", "operation");
	const plugin = table("plugin", "plugin");

	return document({
		providers: rows(provider, {
			limit: 100,
			where: and(
				eq(column(provider, "rootEntitySchemaSlug"), literal(input.rootEntitySchemaSlug)),
				eq(column(operation, "operation"), literal("search")),
				eq(column(plugin, "status"), literal("active")),
			),
			joins: [
				join("inner", operation, eq(column(provider, "id"), column(operation, "providerId"))),
				join("inner", plugin, eq(column(provider, "pluginSlug"), column(plugin, "slug"))),
			],
			orderBy: [
				ascending(column(provider, "name")),
				ascending(column(provider, "slug")),
				ascending(column(provider, "id")),
			],
			fields: [
				field("providerId", column(provider, "id")),
				field("providerSlug", column(provider, "slug")),
				field("providerName", column(provider, "name")),
				field("rootEntitySchemaSlug", column(provider, "rootEntitySchemaSlug")),
				field("searchOptionsSchema", column(operation, "optionsSchema")),
			],
		}),
	});
};

const decodeProviderSearchResult = Schema.decodeUnknownResult(providerSearchResponse);

export const decodeProviderSearchResponse = (response: unknown) =>
	Result.flatMap(decodeProviderSearchResult(response), ({ data }) =>
		Result.map(
			Result.all(data.providers.items.map(decodeProviderSearch)),
			(items) => ({ items, pageInfo: data.providers.pageInfo }) satisfies ProviderSearchList,
		),
	);
