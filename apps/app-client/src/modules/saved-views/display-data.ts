import {
	BooleanFieldValue,
	DateFieldValue,
	JsonFieldValue,
	NullFieldValue,
	NumberFieldValue,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import type { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
import { DateTime, Option, Result, Schema } from "effect";

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
	| { readonly type: "url"; readonly url: string };

export type SavedViewCardData = {
	readonly title: string;
	readonly image: SavedViewImage;
	readonly callout?: SavedViewScalarValue | undefined;
	readonly overline?: SavedViewScalarValue | undefined;
	readonly primaryMetadata?: SavedViewScalarValue | undefined;
	readonly secondaryMetadata?: SavedViewScalarValue | undefined;
};

export type SavedViewDisplayItem = {
	readonly id: string;
	readonly grid: SavedViewCardData;
	readonly list: SavedViewCardData;
	readonly table: {
		readonly image: SavedViewImage;
		readonly cells: readonly { readonly label: string; readonly value: SavedViewScalarValue }[];
	};
};

export type SavedViewDisplayData = {
	readonly items: readonly SavedViewDisplayItem[];
	readonly pageInfo: (typeof savedViewRowsResponse.Type)["data"][string]["pageInfo"];
};

type ScalarRow = Readonly<Record<string, SavedViewScalarValue>>;
type CardConfiguration = SavedViewDisplayConfiguration["grid"];

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
		if (value.kind === "null" || (value.kind === "text" && value.value.trim() === "")) {
			return { type: "missing" } as const;
		}
		if (value.kind === "text") {
			return { type: "url", url: value.value } as const;
		}
		return yield* Result.fail(
			new Error(`Expected saved-view image field ${field} to be text or null`),
		);
	});
};

const getOptionalValue = (row: ScalarRow, field: string | null) => {
	if (field === null) {
		return Result.succeed(undefined);
	}
	return Result.map(getField(row, field), (value) => (value.kind === "null" ? undefined : value));
};

const decodeCard = (row: ScalarRow, configuration: CardConfiguration) =>
	Result.gen(function* () {
		const title = yield* getText(row, configuration.titleField);
		const image = yield* getImage(row, configuration.imageField);
		const callout = yield* getOptionalValue(row, configuration.calloutField);
		const overline = yield* getOptionalValue(row, configuration.overlineField);
		const primaryMetadata = yield* getOptionalValue(row, configuration.primaryMetadataField);
		const secondaryMetadata = yield* getOptionalValue(row, configuration.secondaryMetadataField);
		return { title, image, callout, overline, primaryMetadata, secondaryMetadata };
	});

const validateDates = (row: ScalarRow) => {
	for (const value of Object.values(row)) {
		if (value.kind === "date" && Option.isNone(DateTime.make(value.value))) {
			return Result.fail(new Error(`Expected saved-view date to be valid: ${value.value}`));
		}
	}
	return Result.succeed(row);
};

const decodeItem = (row: ScalarRow, configuration: SavedViewDisplayConfiguration) =>
	Result.gen(function* () {
		yield* validateDates(row);
		const id = yield* getText(row, configuration.entityIdField);
		const grid = yield* decodeCard(row, configuration.grid);
		const list = yield* decodeCard(row, configuration.list);
		const image = yield* getImage(row, configuration.table.imageField);
		const cells = yield* Result.all(
			configuration.table.columns.map(({ field, label }) =>
				Result.map(getField(row, field), (value) => ({ label, value })),
			),
		);
		return { id, grid, list, table: { image, cells } };
	});

export const decodeSavedViewDisplayData = (
	response: unknown,
	configuration: SavedViewDisplayConfiguration,
) =>
	Result.gen(function* () {
		const { data } = yield* Schema.decodeUnknownResult(savedViewRowsResponse)(response);
		const results = Object.values(data);
		if (results.length !== 1) {
			return yield* Result.fail(new Error("Expected one saved-view rows result"));
		}
		const [result] = results;
		const items = yield* Result.all(result.items.map((row) => decodeItem(row, configuration)));
		return { items, pageInfo: result.pageInfo } satisfies SavedViewDisplayData;
	});
