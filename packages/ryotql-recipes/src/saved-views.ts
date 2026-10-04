import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import { SavedViewClientPageTarget } from "@ryot-app/contract/modules/pages/schemas";
import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import {
	RyotQLDocument,
	rowsResultSchema,
	type FieldSelection,
	type NamedQuery,
	type OrderBy,
	type Predicate,
	type RowsOutput,
	type TableReference,
	type ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	type EntityBrowserSavedViewSettings as EntityBrowserSavedViewSettingsValue,
	ResultsTableSavedViewSettings,
	SavedViewDisplayValue,
	type SavedViewSubject,
	type ResultsTableSavedViewSettings as ResultsTableSavedViewSettingsValue,
	type SavedViewDisplayKind,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	castText,
	column,
	contains,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	field,
	literal,
	or,
	type PreparedRecipe,
	selectedAggregate,
	selectedMeasure,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const populationStatusField = "populationStatus";

const translationStatusField = "translationStatus";

export type SavedViewResult<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
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
	if (displayKind === "number" && typeof value === "number") {
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

const syncFields = (row: SavedViewRawRow, populationField: string, translationField: string) =>
	Result.flatMap(
		Result.all([rawField(row, populationField), rawField(row, translationField)]),
		([populationStatus, translationStatus]) =>
			Schema.decodeUnknownResult(EntitySyncState)({ populationStatus, translationStatus }),
	);

const nullableTextField = (row: SavedViewRawRow, fieldName: string) =>
	Result.flatMap(rawField(row, fieldName), (value) =>
		value === null || typeof value === "string"
			? Result.succeed(value)
			: Result.fail(new Error(`Saved-view field '${fieldName}' must be nullable text`)),
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

type EntityBrowserRecipeInput = {
	readonly after?: string | undefined;
	readonly queryDocument: RyotQLDocument;
	readonly searchText?: string | undefined;
	readonly sortChoice?: string | undefined;
	readonly settings: EntityBrowserSavedViewSettingsValue;
};

export const SavedViewPageIdentity = Schema.Struct({ icon: Schema.String, name: Schema.String });

export const EntityBrowserPageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	target: SavedViewClientPageTarget,
	settings: EntityBrowserSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
});

type RowsQuery = NamedQuery & { readonly output: RowsOutput };

const getNamedRowsQuery = (
	queryDocument: RyotQLDocument,
	sourceName: string,
): Result.Result<RowsQuery, Error> => {
	const query = queryDocument.queries[sourceName];
	if (!query) {
		return Result.fail(new Error(`Entity-browser source '${sourceName}' does not exist`));
	}
	if (query.output.type !== "rows") {
		return Result.fail(new Error(`Entity-browser source '${sourceName}' must produce rows`));
	}
	return Result.succeed({ ...query, output: query.output });
};

const unusedFieldKey = (fields: readonly FieldSelection[], base: string) => {
	const keys = new Set(fields.map(({ key }) => key));
	let key = base;
	while (keys.has(key)) {
		key = `_${key}`;
	}
	return key;
};

const selectedFields = (source: RowsQuery) =>
	source.output.fields.flatMap((selection) => ("key" in selection ? [selection] : []));

const browserSearchPredicate = (
	source: RowsQuery,
	settings: Pick<EntityBrowserSavedViewSettingsValue, "searchFields">,
	searchText: string | undefined,
): Result.Result<Predicate | undefined, Error> => {
	if (searchText === undefined || searchText.length === 0) {
		return Result.succeed(undefined);
	}
	const fields = selectedFields(source);
	const expressions: ScalarExpression[] = [];
	for (const key of settings.searchFields) {
		const selection = fields.find((candidate) => candidate.key === key);
		if (!selection) {
			return Result.fail(new Error(`Entity-browser search field '${key}' is missing or unusable`));
		}
		expressions.push(selection.expr);
	}
	return expressions.length === 0
		? Result.succeed(undefined)
		: Result.succeed(
				or(...expressions.map((expression) => contains(castText(expression), literal(searchText)))),
			);
};

const combineWhere = (fixed: Predicate | undefined, runtime: Predicate | undefined) => {
	if (!runtime) {
		return fixed;
	}
	return fixed ? and(fixed, runtime) : runtime;
};

const browserOrderBy = (
	source: RowsQuery,
	settings: EntityBrowserSavedViewSettingsValue,
	sortChoice: string | undefined,
	entityId: ScalarExpression,
): Result.Result<readonly OrderBy[], Error> => {
	const fields = selectedFields(source);
	const choice =
		sortChoice === undefined
			? undefined
			: settings.sortChoices.find((candidate) => candidate.name === sortChoice);
	if (sortChoice !== undefined && !choice) {
		return Result.fail(new Error(`Entity-browser sort choice '${sortChoice}' is not declared`));
	}
	const configured: OrderBy[] = [];
	for (const ordering of choice ? choice.orderBy : []) {
		const selection = fields.find((candidate) => candidate.key === ordering.field);
		if (!selection) {
			return Result.fail(
				new Error(`Entity-browser sort field '${ordering.field}' is missing or unusable`),
			);
		}
		configured.push(
			ordering.direction === "asc" ? ascending(selection.expr) : descending(selection.expr),
		);
	}
	return Result.succeed([...(choice ? configured : source.output.orderBy), ascending(entityId)]);
};

const subjectSchemaPredicate = (subject: SavedViewSubject, entity: TableReference) =>
	or(
		...subject.schemas.map(({ slug, owner }) =>
			entitySchemaPredicate(entity, slug, ownerIdentityReference(owner)),
		),
	);

export const entityBrowserRecipe = (
	input: EntityBrowserRecipeInput,
): Result.Result<PreparedRecipe<EntityBrowserResult>, Error> =>
	Result.flatMap(getNamedRowsQuery(input.queryDocument, input.settings.sourceName), (source) => {
		const fields = selectedFields(source);
		const entity = table("entity", input.settings.subject.entityAlias);
		const searchResult = browserSearchPredicate(source, input.settings, input.searchText);
		if (Result.isFailure(searchResult)) {
			return Result.fail(searchResult.failure);
		}
		const orderByResult = browserOrderBy(
			source,
			input.settings,
			input.sortChoice,
			column(entity, "id"),
		);
		if (Result.isFailure(orderByResult)) {
			return Result.fail(orderByResult.failure);
		}
		const search = searchResult.success;
		const orderBy = orderByResult.success;
		const nameField = unusedFieldKey(fields, "__entityBrowserName");
		const idField = unusedFieldKey(fields, "__entityBrowserId");
		const ownerField = unusedFieldKey(fields, "__entityBrowserOwnerPluginId");
		const schemaSlugField = unusedFieldKey(fields, "__entityBrowserSchemaSlug");
		const populationField = unusedFieldKey(fields, "__entityBrowserPopulationStatus");
		const translationField = unusedFieldKey(fields, "__entityBrowserTranslationStatus");
		const query = {
			...source,
			where: combineWhere(
				combineWhere(source.where, subjectSchemaPredicate(input.settings.subject, entity)),
				search,
			),
			output: {
				...source.output,
				orderBy,
				pagination: {
					limit: input.settings.pageSize,
					...(input.after === undefined ? {} : { after: input.after }),
				},
				fields: [
					...source.output.fields,
					field(idField, column(entity, "id")),
					field(ownerField, column(entity, "entitySchemaPluginId")),
					field(schemaSlugField, column(entity, "entitySchemaSlug")),
					field(nameField, column(entity, "name")),
					field(populationField, column(entity, populationStatusField)),
					field(translationField, column(entity, translationStatusField)),
				],
			},
		};
		const recipe = defineRecipe(() => ({
			map: ({ entityBrowser }) => Result.succeed(entityBrowser),
			queries: {
				entityBrowser: {
					document: query,
					decodeResult: (result: unknown) =>
						Result.flatMap(
							Schema.decodeUnknownResult(savedViewRows)(result),
							({ items, pageInfo }) =>
								Result.gen(function* () {
									const decoded = yield* Result.all(
										items.map((row) =>
											Result.gen(function* () {
												const cells = yield* Result.all(
													(input.settings.tableColumns ?? []).map(
														({ label, displayKind, field: fieldName }) =>
															Result.flatMap(rawField(row, fieldName), (value) =>
																Result.map(
																	displayValue(value, displayKind, fieldName),
																	(cellValue) => ({ label, key: fieldName, value: cellValue }),
																),
															),
													),
												);
												const item = {
													cells,
													presentation: row,
													name: yield* textField(row, nameField),
													entityId: yield* textField(row, idField),
													entitySchemaSlug: yield* textField(row, schemaSlugField),
													ownerPluginId: yield* nullableTextField(row, ownerField),
													sync: yield* syncFields(row, populationField, translationField),
												};
												return yield* Schema.decodeResult(EntityBrowserResultItem)(item);
											}),
										),
									);
									const seen = new Set<string>();
									for (const item of decoded) {
										if (seen.has(item.entityId)) {
											return yield* Result.fail(
												new Error(
													`Entity-browser page contains duplicate entity ID '${item.entityId}'`,
												),
											);
										}
										seen.add(item.entityId);
									}
									return { pageInfo, items: decoded };
								}),
						),
				},
			},
		}));
		return Result.succeed(recipe());
	});

export const entityBrowserCountRecipe = (
	queryDocument: RyotQLDocument,
	settings: Pick<EntityBrowserSavedViewSettingsValue, "sourceName" | "subject" | "searchFields">,
	input: { readonly searchText?: string | undefined } = {},
): Result.Result<PreparedRecipe<number>, Error> =>
	Result.flatMap(getNamedRowsQuery(queryDocument, settings.sourceName), (query) => {
		const entity = table("entity", settings.subject.entityAlias);
		const searchResult = browserSearchPredicate(query, settings, input.searchText);
		if (Result.isFailure(searchResult)) {
			return Result.fail(searchResult.failure);
		}
		const search = searchResult.success;
		const recipe = defineRecipe(() => ({
			map: ({ entityBrowserCount }) => Result.succeed(entityBrowserCount.total),
			queries: {
				entityBrowserCount: selectedAggregate(query.from, {
					joins: query.joins,
					where: combineWhere(
						combineWhere(query.where, subjectSchemaPredicate(settings.subject, entity)),
						search,
					),
					measures: {
						total: selectedMeasure(
							{ function: "countDistinct", expr: column(entity, "id") },
							Schema.Finite,
						),
					},
				}),
			},
		}));
		return Result.succeed(recipe());
	});

export const ResultsTablePageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	target: SavedViewClientPageTarget,
	settings: ResultsTableSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
});

export type ResultsTableResultItem = {
	readonly key: string;
	readonly entityId: string | undefined;
	readonly cells: readonly {
		readonly key: string;
		readonly label: string;
		readonly value: SavedViewDisplayValue;
	}[];
};

export type ResultsTableResult = SavedViewResult<ResultsTableResultItem>;

type ResultsTableRecipeInput = {
	readonly after?: string | undefined;
	readonly queryDocument: RyotQLDocument;
	readonly settings: ResultsTableSavedViewSettingsValue;
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

export const resultsTableRecipe = (
	input: ResultsTableRecipeInput,
): Result.Result<PreparedRecipe<ResultsTableResult>, Error> =>
	Result.map(getNamedRowsQuery(input.queryDocument, input.settings.sourceName), (source) => {
		const query = {
			...source,
			output: {
				...source.output,
				pagination: {
					limit: input.settings.pageSize,
					...(input.after === undefined ? {} : { after: input.after }),
				},
			},
		};
		const recipe = defineRecipe(() => ({
			map: ({ resultsTable }) => Result.succeed(resultsTable),
			queries: {
				resultsTable: {
					document: query,
					decodeResult: (result: unknown) =>
						Result.flatMap(
							Schema.decodeUnknownResult(savedViewRows)(result),
							({ items, pageInfo }) =>
								Result.gen(function* () {
									const decoded = yield* Result.all(
										items.map((row) => resultsTableItem(row, input.settings)),
									);
									const keys = new Set<string>();
									for (const item of decoded) {
										if (keys.has(item.key)) {
											return yield* Result.fail(
												new Error(`Results-table page contains duplicate row key '${item.key}'`),
											);
										}
										keys.add(item.key);
									}
									return { pageInfo, items: decoded };
								}),
						),
				},
			},
		}));
		return recipe();
	});
