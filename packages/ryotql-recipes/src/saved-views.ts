import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import { SavedViewClientPageTarget } from "@ryot-app/contract/modules/pages/schemas";
import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import {
	type FieldSelection,
	RyotQLDocument,
	type TableReference,
} from "@ryot-app/contract/modules/ryotql/authored";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import {
	entityBrowserFields,
	EntityBrowserRowFields,
} from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import {
	EntityBrowserSavedViewSettings,
	type EntityBrowserSavedViewSettings as EntityBrowserSavedViewSettingsValue,
	ResultsTableSavedViewSettings,
	type ResultsTableSavedViewSettings as ResultsTableSavedViewSettingsValue,
	type SavedViewDisplayKind,
	SavedViewDisplayValue,
	type SavedViewSubject,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { entitySchemaPredicate, or } from "@ryot-app/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

export type SavedViewResult<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: null | string;
	};
};

const displayValue = (
	value: JsonValue,
	displayKind: SavedViewDisplayKind,
	fieldName: string,
): Result.Result<SavedViewDisplayValue, Error> => {
	if (value === null) {
		return Result.succeed({ value, displayKind });
	}
	if (displayKind === "json") {
		return Result.succeed({ value, displayKind });
	}
	if (displayKind === "managed-asset") {
		return Result.map(Schema.decodeUnknownResult(AssetLocator)(value), (asset) => ({
			displayKind,
			value: asset,
		}));
	}
	if (displayKind === "date") {
		return typeof value === "string" && Option.isSome(DateTime.make(value))
			? Result.succeed({ value, displayKind })
			: Result.fail(new Error(`Saved-view field '${fieldName}' must be a valid date`));
	}
	if (displayKind === "text" && typeof value === "string") {
		return Result.succeed({ value, displayKind });
	}
	if (
		(displayKind === "number" || displayKind === "year" || displayKind === "rating") &&
		typeof value === "number"
	) {
		return Result.succeed({ value, displayKind });
	}
	if (displayKind === "boolean" && typeof value === "boolean") {
		return Result.succeed({ value, displayKind });
	}
	return Result.fail(new Error(`Saved-view field '${fieldName}' must be ${displayKind}`));
};

type SavedViewRawRow = Readonly<Record<string, JsonValue>>;

const rawField = (row: SavedViewRawRow, fieldName: string): Result.Result<JsonValue, Error> => {
	const value = row[fieldName];
	return value === undefined
		? Result.fail(new Error(`Saved-view row is missing field '${fieldName}'`))
		: Result.succeed(value);
};

const textField = (row: SavedViewRawRow, fieldName: string) =>
	Result.flatMap(rawField(row, fieldName), (value) =>
		typeof value === "string"
			? Result.succeed(value)
			: Result.fail(new Error(`Saved-view field '${fieldName}' must be text`)),
	);

const savedViewRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));

export const EntityBrowserResultItem = Schema.Struct({
	name: Schema.String,
	sync: EntitySyncState,
	entityId: Schema.String,
	entitySchemaSlug: Schema.String,
	ownerPluginId: Schema.NullOr(Schema.String),
	presentation: Schema.NullOr(Schema.Record(Schema.String, JsonValue)),
	cells: Schema.Array(
		Schema.Struct({ key: Schema.String, label: Schema.String, value: SavedViewDisplayValue }),
	),
});
export type EntityBrowserResultItem = typeof EntityBrowserResultItem.Type;

export type EntityBrowserResult = SavedViewResult<EntityBrowserResultItem>;

export const SavedViewPageIdentity = Schema.Struct({ icon: Schema.String, name: Schema.String });
export const EntityBrowserPageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	target: SavedViewClientPageTarget,
	settings: EntityBrowserSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
});
export const unusedFieldKey = (fields: readonly FieldSelection[], base: string) => {
	const keys = new Set(fields.map(({ key }) => key));
	let key = base;
	while (keys.has(key)) {
		key = `_${key}`;
	}
	return key;
};
export const subjectSchemaPredicate = (subject: SavedViewSubject, entity: TableReference) =>
	or(
		...subject.schemas.map(({ slug, owner }) =>
			entitySchemaPredicate(entity, slug, ownerIdentityReference(owner)),
		),
	);

export const LibrarySearchHit = Schema.Struct({
	name: Schema.String,
	rank: Schema.Finite,
	entityId: Schema.String,
	image: Schema.NullOr(AssetLocator),
	subtitle: Schema.NullOr(SavedViewDisplayValue),
});
export type LibrarySearchHit = typeof LibrarySearchHit.Type;

export type LibrarySearchResult = {
	readonly total: number;
	readonly hits: readonly LibrarySearchHit[];
};

export const ResultsTablePageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	target: SavedViewClientPageTarget,
	settings: ResultsTableSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
});

export type ResultsTableResult = SavedViewResult<ResultsTableResultItem>;

export type ResultsTableResultItem = {
	readonly key: string;
	readonly entityId: string | undefined;
	readonly cells: readonly {
		readonly key: string;
		readonly label: string;
		readonly value: SavedViewDisplayValue;
	}[];
};

const isJsonRecord = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const typedKeyPart = (value: JsonValue): JsonValue => {
	if (Array.isArray(value)) {
		return { type: "array", value: value.map(typedKeyPart) };
	}
	if (isJsonRecord(value)) {
		return {
			type: "object",
			value: Object.fromEntries(
				Object.entries(value)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, part]) => [key, typedKeyPart(part)]),
			),
		};
	}
	return { value, type: typeof value };
};

const resultsTableItem = (row: SavedViewRawRow, settings: ResultsTableSavedViewSettingsValue) =>
	Result.gen(function* () {
		const keyParts = yield* Result.all(
			settings.rowKeyFields.map((fieldName) =>
				Result.flatMap(rawField(row, fieldName), (value) =>
					value === null
						? Result.fail(new Error(`Results-table row key field '${fieldName}' must not be null`))
						: Result.succeed(typedKeyPart(value)),
				),
			),
		);
		const cells = yield* Result.all(
			settings.columns.map(({ label, displayKind, field: fieldName }) =>
				Result.flatMap(rawField(row, fieldName), (value) =>
					Result.map(displayValue(value, displayKind, fieldName), (decoded) => ({
						label,
						key: fieldName,
						value: decoded,
					})),
				),
			),
		);
		const entityId = settings.entityLink
			? yield* textField(row, settings.entityLink.entityIdField)
			: undefined;
		return { cells, entityId, key: JSON.stringify(keyParts) };
	});

export const decodeEntityBrowserResult = (
	response: unknown,
	query: string,
	settings: EntityBrowserSavedViewSettingsValue,
): Result.Result<EntityBrowserResult, unknown> =>
	Result.gen(function* () {
		const envelope = yield* Schema.decodeUnknownResult(
			Schema.Struct({ data: Schema.Record(Schema.String, savedViewRows) }),
		)(response);
		const page = envelope.data[query];
		if (page === undefined) {
			return yield* Result.fail(new Error(`Missing saved query '${query}'`));
		}
		const items = yield* Result.all(
			page.items.map((row) =>
				Result.gen(function* () {
					const values = yield* Schema.decodeUnknownResult(EntityBrowserRowFields)(row);
					const cells = yield* Result.all(
						(settings.tableColumns ?? []).map(({ label, field: key, displayKind }) =>
							Result.flatMap(rawField(row, key), (value) =>
								Result.map(displayValue(value, displayKind, key), (decoded) => ({
									key,
									label,
									value: decoded,
								})),
							),
						),
					);
					return {
						cells,
						presentation: row,
						name: values[entityBrowserFields.name],
						entityId: values[entityBrowserFields.id],
						ownerPluginId: values[entityBrowserFields.owner],
						entitySchemaSlug: values[entityBrowserFields.schema],
						sync: {
							populationStatus: values[entityBrowserFields.population],
							translationStatus: values[entityBrowserFields.translation],
						},
					};
				}),
			),
		);
		if (new Set(items.map((item) => item.entityId)).size !== items.length) {
			return yield* Result.fail(new Error("Entity-browser page contains duplicate entity IDs"));
		}
		return { items, pageInfo: page.pageInfo };
	});

export const decodeSavedViewCount = (response: unknown) =>
	Result.flatMap(
		Schema.decodeUnknownResult(
			Schema.Struct({
				data: Schema.Struct({
					count: Schema.Struct({
						type: Schema.Literal("aggregate"),
						items: Schema.Array(Schema.Struct({ count: Schema.Finite })),
					}),
				}),
			}),
		)(response),
		({ data }) =>
			data.count.items.length === 1 && data.count.items[0] !== undefined
				? Result.succeed(data.count.items[0].count)
				: Result.fail(new Error("Saved-view count must contain one row")),
	);

export const decodeSavedViewIds = (response: unknown) =>
	Result.map(
		Schema.decodeUnknownResult(
			Schema.Struct({
				data: Schema.Struct({ ids: rowsResultSchema(Schema.Struct({ id: Schema.String })) }),
			}),
		)(response),
		({ data }) => ({ pageInfo: data.ids.pageInfo, items: data.ids.items.map(({ id }) => id) }),
	);

export const decodeResultsTableResult = (
	response: unknown,
	query: string,
	settings: ResultsTableSavedViewSettingsValue,
): Result.Result<ResultsTableResult, unknown> =>
	Result.gen(function* () {
		const envelope = yield* Schema.decodeUnknownResult(
			Schema.Struct({ data: Schema.Record(Schema.String, savedViewRows) }),
		)(response);
		const page = envelope.data[query];
		if (page === undefined) {
			return yield* Result.fail(new Error(`Missing saved query '${query}'`));
		}
		const items = yield* Result.all(page.items.map((row) => resultsTableItem(row, settings)));
		if (new Set(items.map((item) => item.key)).size !== items.length) {
			return yield* Result.fail(new Error("Results-table page contains duplicate row keys"));
		}
		return { items, pageInfo: page.pageInfo };
	});
