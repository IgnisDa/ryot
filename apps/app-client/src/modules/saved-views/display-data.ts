import {
	BooleanFieldValue,
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	NumberFieldValue,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import {
	AssetLocator,
	type AssetLocator as AssetLocatorType,
	type DownloadResolutionResponse,
	type ManagedAssetLocator,
} from "@ryot/contract/modules/uploads/schemas";
import { DateTime, Option, Result, Schema } from "effect";

import { resolveApiUrl } from "@/modules/server/url";

import { canonicalManagedAssets, managedAssetKey } from "./managed-assets";

const SavedViewScalarValue = Schema.Union([
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	TextFieldValue,
	NumberFieldValue,
	BooleanFieldValue,
]);

const savedViewRowsResponse = Schema.Struct({
	data: Schema.Record(
		Schema.String,
		rowsResultSchema(Schema.Record(Schema.String, SavedViewScalarValue)),
	),
});

export type SavedViewScalarValue = typeof SavedViewScalarValue.Type;

export type SavedViewImage =
	| { readonly type: "missing" }
	| { readonly type: "unconfigured" }
	| { readonly type: "asset"; readonly locator: AssetLocatorType };

export type SavedViewCardItem = {
	readonly title: string;
	readonly entityId: string;
	readonly image: SavedViewImage;
	readonly callout?: SavedViewScalarValue | undefined;
	readonly overline?: SavedViewScalarValue | undefined;
	readonly primaryMetadata?: SavedViewScalarValue | undefined;
	readonly secondaryMetadata?: SavedViewScalarValue | undefined;
};

export type SavedViewTableItem = {
	readonly entityId: string;
	readonly image: SavedViewImage;
	readonly cells: readonly {
		readonly key: string;
		readonly label: string;
		readonly value: SavedViewScalarValue;
	}[];
};

export type SavedViewDisplayData<Item extends SavedViewCardItem | SavedViewTableItem> = {
	readonly items: readonly Item[];
	readonly pageInfo: (typeof savedViewRowsResponse.Type)["data"][string]["pageInfo"];
};

type CardLayout = SavedViewLayouts["grid"];
type TableLayout = SavedViewLayouts["table"];
type ScalarRow = Readonly<Record<string, SavedViewScalarValue>>;

const missingField = (field: string) =>
	Result.fail(new Error(`Missing saved-view field: ${field}`));

const getField = (row: ScalarRow, field: string) =>
	Object.hasOwn(row, field) ? Result.succeed(row[field]) : missingField(field);

const getText = (row: ScalarRow, field: string) =>
	Result.flatMap(getField(row, field), (value) =>
		value.kind === "text"
			? Result.succeed(value.value)
			: Result.fail(new Error(`Expected saved-view field ${field} to be text`)),
	);

const getImage = (row: ScalarRow, field: string | null): Result.Result<SavedViewImage, Error> => {
	if (field === null) {
		return Result.succeed({ type: "unconfigured" } as const);
	}
	return Result.gen(function* () {
		const value = yield* getField(row, field);
		if (value.kind === "null") {
			return { type: "missing" } as const;
		}
		if (value.kind === "json") {
			const locator = yield* Schema.decodeUnknownResult(AssetLocator)(value.value);
			return { type: "asset", locator } as const;
		}
		return yield* Result.fail(
			new Error(`Expected saved-view image field ${field} to be AssetLocator JSON or null`),
		);
	});
};

export const collectManagedAssets = (
	items: readonly (SavedViewCardItem | SavedViewTableItem)[],
) => {
	const assets: ManagedAssetLocator[] = [];
	for (const item of items) {
		const { image } = item;
		if (image.type === "asset" && image.locator.type !== "remote") {
			assets.push(image.locator);
		}
	}
	return canonicalManagedAssets(assets);
};

export const resolvedAssetUrls = (response: DownloadResolutionResponse, serverUrl: string) =>
	new Map(
		response.map(({ asset, downloadUrl }) => [
			managedAssetKey(asset),
			resolveApiUrl(serverUrl, downloadUrl),
		]),
	);

export const resolveSavedViewImageUrl = (
	image: SavedViewImage,
	managedUrls: ReadonlyMap<string, string>,
) => {
	if (image.type !== "asset") {
		return undefined;
	}
	return image.locator.type === "remote"
		? image.locator.url
		: managedUrls.get(managedAssetKey(image.locator));
};

const getOptionalValue = (row: ScalarRow, field: string | null) => {
	if (field === null) {
		return Result.succeed(undefined);
	}
	return Result.map(getField(row, field), (value) => (value.kind === "null" ? undefined : value));
};

const decodeCard = (row: ScalarRow, layout: CardLayout) =>
	Result.gen(function* () {
		const entityId = yield* getText(row, layout.entityIdField);
		const title = yield* getText(row, layout.titleField);
		const image = yield* getImage(row, layout.imageField);
		const callout = yield* getOptionalValue(row, layout.calloutField);
		const overline = yield* getOptionalValue(row, layout.overlineField);
		const primaryMetadata = yield* getOptionalValue(row, layout.primaryMetadataField);
		const secondaryMetadata = yield* getOptionalValue(row, layout.secondaryMetadataField);
		return { entityId, title, image, callout, overline, primaryMetadata, secondaryMetadata };
	});

const validateDates = (row: ScalarRow) => {
	for (const value of Object.values(row)) {
		if (value.kind === "date" && Option.isNone(DateTime.make(value.value))) {
			return Result.fail(new Error(`Expected saved-view date to be valid: ${value.value}`));
		}
	}
	return Result.succeed(row);
};

const decodeTable = (row: ScalarRow, layout: TableLayout) =>
	Result.gen(function* () {
		yield* validateDates(row);
		const entityId = yield* getText(row, layout.entityIdField);
		const image = yield* getImage(row, layout.imageField);
		const cells = yield* Result.all(
			layout.columns.map(({ field, label }) =>
				Result.map(getField(row, field), (value) => ({ key: field, label, value })),
			),
		);
		return { entityId, image, cells };
	});

const decodeRows = <Item>(
	response: unknown,
	decodeItem: (row: ScalarRow) => Result.Result<Item, Error>,
) =>
	Result.gen(function* () {
		const { data } = yield* Schema.decodeUnknownResult(savedViewRowsResponse)(response);
		const results = Object.values(data);
		if (results.length !== 1) {
			return yield* Result.fail(new Error("Expected one saved-view rows result"));
		}
		const [result] = results;
		const items = yield* Result.all(result.items.map(decodeItem));
		return { items, pageInfo: result.pageInfo };
	});

export const decodeSavedViewCardData = (response: unknown, layout: CardLayout) =>
	decodeRows(response, (row) =>
		Result.flatMap(validateDates(row), (validRow) => decodeCard(validRow, layout)),
	);

export const decodeSavedViewTableData = (response: unknown, layout: TableLayout) =>
	decodeRows(response, (row) => decodeTable(row, layout));
