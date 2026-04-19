import {
	BooleanFieldValue,
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	NumberFieldValue,
	RyotQLDocument,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
import { PluginSlug, SavedViewId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import { and, ascending, column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const nullableTextFieldValue = Schema.Union([TextFieldValue, NullFieldValue]);

const savedViewRecordWire = strictStruct({
	id: TextFieldValue,
	slug: TextFieldValue,
	name: TextFieldValue,
	icon: TextFieldValue,
	createdAt: DateFieldValue,
	updatedAt: DateFieldValue,
	sortOrder: NumberFieldValue,
	isBuiltin: BooleanFieldValue,
	isDisabled: BooleanFieldValue,
	queryDocument: JsonFieldValue,
	pluginSlug: nullableTextFieldValue,
	displayConfiguration: JsonFieldValue,
});

const savedViewRecordsResponse = strictStruct({
	data: strictStruct({ savedViews: rowsResultSchema(savedViewRecordWire) }),
});

const savedViewRecordResponse = strictStruct({
	data: strictStruct({ savedView: rowsResultSchema(savedViewRecordWire) }),
});

export const SavedViewRecord = strictStruct({
	id: SavedViewId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	queryDocument: RyotQLDocument,
	pluginSlug: Schema.NullOr(PluginSlug),
	displayConfiguration: SavedViewDisplayConfiguration,
});
export type SavedViewRecord = typeof SavedViewRecord.Type;

const SavedViewRecordPageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
});

export const SavedViewRecordList = strictStruct({
	items: Schema.Array(SavedViewRecord),
	pageInfo: SavedViewRecordPageInfo,
});
export type SavedViewRecordList = typeof SavedViewRecordList.Type;

const normalizeDate = (fieldName: string, value: typeof DateFieldValue.Type) => {
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error(`Expected RyotQL ${fieldName} to be a valid date`));
};

const decodeSavedViewRecord = (row: typeof savedViewRecordWire.Type) =>
	Result.all([
		normalizeDate("createdAt", row.createdAt),
		normalizeDate("updatedAt", row.updatedAt),
		Schema.decodeUnknownResult(RyotQLDocument)(row.queryDocument.value),
		Schema.decodeUnknownResult(SavedViewDisplayConfiguration)(row.displayConfiguration.value),
	] as const).pipe(
		Result.map(
			([createdAt, updatedAt, queryDocument, displayConfiguration]) =>
				({
					id: SavedViewId.make(row.id.value),
					createdAt,
					updatedAt,
					queryDocument,
					slug: row.slug.value,
					name: row.name.value,
					icon: row.icon.value,
					displayConfiguration,
					sortOrder: row.sortOrder.value,
					isBuiltin: row.isBuiltin.value,
					isDisabled: row.isDisabled.value,
					pluginSlug: row.pluginSlug.kind === "text" ? PluginSlug.make(row.pluginSlug.value) : null,
				}) satisfies SavedViewRecord,
		),
	);

export const buildSavedViewRecordsDocument = (input: {
	readonly page: number;
	readonly limit: number;
	readonly pluginSlug?: string | undefined;
	readonly includeDisabled?: boolean | undefined;
}) => {
	const savedView = table("savedView", "savedView");
	const predicates = [
		...((input.includeDisabled ?? false)
			? []
			: [eq(column(savedView, "isDisabled"), literal(false))]),
		...(input.pluginSlug ? [eq(column(savedView, "pluginSlug"), literal(input.pluginSlug))] : []),
	];

	return document({
		savedViews: rows(savedView, {
			page: input.page,
			limit: input.limit,
			where: predicates.length > 0 ? and(...predicates) : undefined,
			orderBy: [
				ascending(column(savedView, "pluginSlug")),
				ascending(column(savedView, "sortOrder")),
				ascending(column(savedView, "createdAt")),
			],
			fields: [
				field("id", column(savedView, "id")),
				field("slug", column(savedView, "slug")),
				field("name", column(savedView, "name")),
				field("icon", column(savedView, "icon")),
				field("sortOrder", column(savedView, "sortOrder")),
				field("createdAt", column(savedView, "createdAt")),
				field("updatedAt", column(savedView, "updatedAt")),
				field("isBuiltin", column(savedView, "isBuiltin")),
				field("isDisabled", column(savedView, "isDisabled")),
				field("queryDocument", column(savedView, "queryDocument")),
				field("pluginSlug", column(savedView, "pluginSlug")),
				field("displayConfiguration", column(savedView, "displayConfiguration")),
			],
		}),
	});
};

export const buildSavedViewRecordDocument = (input: { readonly slug: string }) => {
	const savedView = table("savedView", "savedView");
	return document({
		savedView: rows(savedView, {
			limit: 1,
			orderBy: [ascending(column(savedView, "id"))],
			where: eq(column(savedView, "slug"), literal(input.slug)),
			fields: [
				field("id", column(savedView, "id")),
				field("slug", column(savedView, "slug")),
				field("name", column(savedView, "name")),
				field("icon", column(savedView, "icon")),
				field("sortOrder", column(savedView, "sortOrder")),
				field("createdAt", column(savedView, "createdAt")),
				field("updatedAt", column(savedView, "updatedAt")),
				field("isBuiltin", column(savedView, "isBuiltin")),
				field("isDisabled", column(savedView, "isDisabled")),
				field("queryDocument", column(savedView, "queryDocument")),
				field("pluginSlug", column(savedView, "pluginSlug")),
				field("displayConfiguration", column(savedView, "displayConfiguration")),
			],
		}),
	});
};

const decodeSavedViewRecordsResult = Schema.decodeUnknownResult(savedViewRecordsResponse);
const decodeSavedViewRecordResult = Schema.decodeUnknownResult(savedViewRecordResponse);

export const decodeSavedViewRecordsResponse = (response: unknown) =>
	Result.flatMap(decodeSavedViewRecordsResult(response), ({ data }) =>
		Result.map(
			Result.all(data.savedViews.items.map(decodeSavedViewRecord)),
			(items) => ({ items, pageInfo: data.savedViews.pageInfo }) satisfies SavedViewRecordList,
		),
	);

export const decodeSavedViewRecordResponse = (response: unknown) =>
	Result.flatMap(decodeSavedViewRecordResult(response), ({ data }) => {
		const [row] = data.savedView.items;
		return row ? decodeSavedViewRecord(row) : Result.succeed(null);
	});
