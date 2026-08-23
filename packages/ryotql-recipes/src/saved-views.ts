import {
	EntitySyncState,
	type EntitySyncState as EntitySyncStateValue,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	JsonValue,
	RyotQLDocument,
	rowsResultSchema,
	type FieldSelection,
	type JsonValue as JsonValueType,
	type NamedQuery,
	type OrderBy,
	type Predicate,
	type RowsOutput,
	type ScalarExpression,
	type TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	type EntityBrowserSavedViewSettings as EntityBrowserSavedViewSettingsValue,
	ResultsTableSavedViewSettings,
	SavedViewDisplayValue,
	type ResultsTableSavedViewSettings as ResultsTableSavedViewSettingsValue,
	type SavedViewDisplayKind,
	type SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	AssetLocator,
	type AssetLocator as AssetLocatorType,
} from "@ryot-app/contract/modules/uploads/schemas";
import {
	and,
	ascending,
	castText,
	column,
	contains,
	defineRecipe,
	descending,
	document,
	eq,
	field,
	inArray,
	literal,
	or,
	type PreparedRecipe,
	rows,
	selectedAggregate,
	selectedMeasure,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

export type SavedViewTableMapping = {
	readonly imageField: string | null;
	readonly columns: readonly [SavedViewTableColumn, ...SavedViewTableColumn[]];
};

type TableColumnExpression = Omit<SavedViewTableMapping["columns"][number], "field"> & {
	readonly expression: ScalarExpression;
};

type TableProjectionInput = {
	readonly entity: TableReference;
	readonly image: ScalarExpression | null;
	readonly columns: readonly [TableColumnExpression, ...TableColumnExpression[]];
};

const populationStatusField = "populationStatus";

const translationStatusField = "translationStatus";

const syncSelections = (entity: TableReference) =>
	[
		field(populationStatusField, column(entity, populationStatusField)),
		field(translationStatusField, column(entity, translationStatusField)),
	] satisfies readonly FieldSelection[];

export type SavedViewLayoutProjectionsInput = { readonly table: TableProjectionInput };

const tableProjection = (input: TableProjectionInput) => {
	const entityId = "entityId";
	const image = "image";
	const [firstTableColumn, ...remainingTableColumns] = input.columns;
	const columns = [
		{ field: "column0", label: firstTableColumn.label, displayKind: firstTableColumn.displayKind },
		...remainingTableColumns.map((tableColumn, index) => ({
			label: tableColumn.label,
			field: `column${index + 1}`,
			displayKind: tableColumn.displayKind,
		})),
	] as const;

	return {
		mappings: {
			columns,
			entityIdField: entityId,
			imageField: input.image === null ? null : image,
		} satisfies SavedViewTableMapping & { readonly entityIdField: string },
		fields: [
			field(entityId, column(input.entity, "id")),
			...(input.image === null ? [] : [field(image, input.image)]),
			...input.columns.map((tableColumn, index) => field(`column${index}`, tableColumn.expression)),
			...syncSelections(input.entity),
		] satisfies readonly FieldSelection[],
	};
};

export const buildSavedViewLayoutProjections = (input: SavedViewLayoutProjectionsInput) => ({
	table: tableProjection(input.table),
});

type SavedViewMapping = {
	readonly type: "table";
	readonly mapping: SavedViewTableMapping & { readonly entityIdField: string };
};

type SavedViewGeneratedSource = {
	readonly type: "generated";
	readonly after?: string | undefined;
	readonly limit?: number | undefined;
	readonly where?: Predicate | undefined;
	readonly fields: readonly FieldSelection[];
	readonly orderBy?: readonly OrderBy[] | undefined;
	readonly entitySchemaSlugs: readonly [string, ...string[]];
};

type SavedViewPersistedSource = {
	readonly type: "persisted";
	readonly queryDocument: RyotQLDocument;
};

type SavedViewRecipeInput = {
	readonly layout: SavedViewMapping;
	readonly source: SavedViewGeneratedSource | SavedViewPersistedSource;
};

export type SavedViewTableResultItem = {
	readonly entityId: string;
	readonly sync: EntitySyncStateValue;
	readonly image: AssetLocatorType | null | undefined;
	readonly cells: readonly {
		readonly key: string;
		readonly label: string;
		readonly value: SavedViewDisplayValue;
	}[];
};

export type SavedViewResult<Item> = {
	readonly items: readonly Item[];
	readonly pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	};
};

const generatedDocument = (input: SavedViewGeneratedSource) => {
	const entity = table("entity", "entity");
	const schema = column(entity, "entitySchemaSlug");
	const schemaFilter =
		input.entitySchemaSlugs.length === 1
			? eq(schema, literal(input.entitySchemaSlugs[0]))
			: inArray(
					schema,
					input.entitySchemaSlugs.map((slug) => literal(slug)),
				);

	return document({
		savedView: rows(entity, {
			after: input.after,
			limit: input.limit,
			fields: input.fields,
			orderBy: input.orderBy ?? [ascending(column(entity, "name"))],
			where: input.where ? and(schemaFilter, input.where) : schemaFilter,
		}),
	});
};

const getOnlyRowsQuery = (queryDocument: RyotQLDocument) => {
	const queries = Object.values(queryDocument.queries);
	if (queries.length !== 1) {
		return Result.fail(new Error("Saved-view document must contain exactly one query"));
	}
	const [query] = queries;
	if (!query) {
		return Result.fail(new Error("Saved-view document must contain one query"));
	}
	if (query.output.type !== "rows") {
		return Result.fail(new Error("Saved-view document query must produce rows"));
	}
	return Result.succeed({ ...query, output: query.output });
};

const displayValue = (
	value: JsonValueType,
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

type SavedViewRawRow = Readonly<Record<string, JsonValueType>>;

const rawField = (row: SavedViewRawRow, fieldName: string): Result.Result<JsonValueType, Error> => {
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

const imageField = (row: SavedViewRawRow, fieldName: string | null) => {
	if (fieldName === null) {
		return Result.succeed(undefined);
	}
	return Result.flatMap(rawField(row, fieldName), (value) =>
		value === null ? Result.succeed(null) : Schema.decodeUnknownResult(AssetLocator)(value),
	);
};

const syncFields = (row: SavedViewRawRow, populationField: string, translationField: string) =>
	Result.flatMap(
		Result.all([rawField(row, populationField), rawField(row, translationField)]),
		([populationStatus, translationStatus]) =>
			Schema.decodeUnknownResult(EntitySyncState)({ populationStatus, translationStatus }),
	);

const syncField = (row: SavedViewRawRow) =>
	syncFields(row, populationStatusField, translationStatusField);

const nullableTextField = (row: SavedViewRawRow, fieldName: string) =>
	Result.flatMap(rawField(row, fieldName), (value) =>
		value === null || typeof value === "string"
			? Result.succeed(value)
			: Result.fail(new Error(`Saved-view field '${fieldName}' must be nullable text`)),
	);

const tableItem = (
	row: SavedViewRawRow,
	mapping: SavedViewTableMapping & { readonly entityIdField: string },
) =>
	Result.gen(function* () {
		const sync = yield* syncField(row);
		const entityId = yield* textField(row, mapping.entityIdField);
		const image = yield* imageField(row, mapping.imageField);
		const cells = yield* Result.all(
			mapping.columns.map(({ label, displayKind, field: fieldName }) =>
				Result.flatMap(rawField(row, fieldName), (value) =>
					Result.map(displayValue(value, displayKind, fieldName), (decoded) => ({
						label,
						key: fieldName,
						value: decoded,
					})),
				),
			),
		);
		return { sync, image, cells, entityId };
	});

const savedViewRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));

const mappedFields = (layout: SavedViewMapping) => [
	layout.mapping.entityIdField,
	...(layout.mapping.imageField === null ? [] : [layout.mapping.imageField]),
	...layout.mapping.columns.map(({ field: fieldName }) => fieldName),
];

const validateMappedFields = (
	query: RyotQLDocument["queries"][string],
	layout: SavedViewMapping,
) => {
	const selectedFields = new Set(
		query.output.type === "rows"
			? query.output.fields.flatMap((selection) => ("key" in selection ? [selection.key] : []))
			: [],
	);
	const missing = mappedFields(layout).filter((fieldName) => !selectedFields.has(fieldName));
	if (missing.length > 0) {
		throw new TypeError(`Saved-view layout references unselected fields: ${missing.join(", ")}`);
	}
};

const savedViewQuery = (query: RyotQLDocument["queries"][string], layout: SavedViewMapping) => ({
	document: query,
	decodeResult: (result: unknown) =>
		Result.flatMap(Schema.decodeUnknownResult(savedViewRows)(result), ({ items, pageInfo }) =>
			Result.map(
				Result.all(items.map((row) => tableItem(row, layout.mapping))),
				(decodedItems) => ({ pageInfo, items: decodedItems }),
			),
		),
});

export function savedViewRecipe(
	input: SavedViewRecipeInput,
): PreparedRecipe<SavedViewResult<SavedViewTableResultItem>> {
	const queryDocument =
		input.source.type === "generated"
			? generatedDocument(input.source)
			: input.source.queryDocument;
	const query = Result.getOrThrow(getOnlyRowsQuery(queryDocument));
	validateMappedFields(query, input.layout);
	const recipe = defineRecipe(() => ({
		map: ({ savedView }) => Result.succeed(savedView),
		queries: { savedView: savedViewQuery(query, input.layout) },
	}));
	return recipe();
}

export const savedViewCountRecipe = (
	queryDocument: RyotQLDocument,
	entityIdField: string,
): Result.Result<PreparedRecipe<number>, Error> =>
	Result.flatMap(getOnlyRowsQuery(queryDocument), (query) =>
		Result.gen(function* () {
			const selection = query.output.fields.find(
				(outSelection): outSelection is FieldSelection =>
					"key" in outSelection && outSelection.key === entityIdField,
			);
			if (selection === undefined) {
				return yield* Result.fail(
					new Error(`Saved-view count field '${entityIdField}' is missing or unusable`),
				);
			}
			const recipe = defineRecipe(() => ({
				map: ({ savedViewCount }) => Result.succeed(savedViewCount.total),
				queries: {
					savedViewCount: selectedAggregate(query.from, {
						where: query.where,
						joins: query.joins,
						measures: {
							total: selectedMeasure(
								{ expr: selection.expr, function: "countDistinct" },
								Schema.Number,
							),
						},
					}),
				},
			}));
			return recipe();
		}),
	);

export const EntityBrowserResultItem = Schema.Struct({
	name: Schema.String,
	sync: EntitySyncState,
	entityId: Schema.String,
	entitySchemaSlug: Schema.String,
	ownerPluginId: Schema.NullOr(Schema.String),
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
	settings: EntityBrowserSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
	target: Schema.Struct({ slug: Schema.String, kind: Schema.Literal("saved-view") }),
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
	entityId: FieldSelection,
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
	return Result.succeed([
		...(choice ? configured : source.output.orderBy),
		ascending(entityId.expr),
	]);
};

export const entityBrowserRecipe = (
	input: EntityBrowserRecipeInput,
): Result.Result<PreparedRecipe<EntityBrowserResult>, Error> =>
	Result.flatMap(getNamedRowsQuery(input.queryDocument, input.settings.sourceName), (source) => {
		const fields = selectedFields(source);
		const entityId = fields.find(({ key }) => key === input.settings.entityIdField);
		if (entityId?.expr.type !== "column") {
			return Result.fail(
				new Error(
					`Entity-browser ID field '${input.settings.entityIdField}' must be a column projection`,
				),
			);
		}
		const searchResult = browserSearchPredicate(source, input.settings, input.searchText);
		if (Result.isFailure(searchResult)) {
			return Result.fail(searchResult.failure);
		}
		const orderByResult = browserOrderBy(source, input.settings, input.sortChoice, entityId);
		if (Result.isFailure(orderByResult)) {
			return Result.fail(orderByResult.failure);
		}
		const search = searchResult.success;
		const orderBy = orderByResult.success;
		const nameField = unusedFieldKey(fields, "__entityBrowserName");
		const populationField = unusedFieldKey(fields, "__entityBrowserPopulationStatus");
		const translationField = unusedFieldKey(fields, "__entityBrowserTranslationStatus");
		const entity = table("entity", entityId.expr.tableAlias);
		const query = {
			...source,
			where: combineWhere(source.where, search),
			output: {
				...source.output,
				orderBy,
				pagination: {
					limit: input.settings.pageSize,
					...(input.after === undefined ? {} : { after: input.after }),
				},
				fields: [
					...source.output.fields,
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
													name: yield* textField(row, nameField),
													entityId: yield* textField(row, input.settings.entityIdField),
													sync: yield* syncFields(row, populationField, translationField),
													entitySchemaSlug: yield* textField(
														row,
														input.settings.entitySchemaSlugField,
													),
													ownerPluginId: yield* nullableTextField(
														row,
														input.settings.ownerPluginIdField,
													),
												};
												return yield* Schema.decodeUnknownResult(EntityBrowserResultItem)(item);
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
	settings: Pick<
		EntityBrowserSavedViewSettingsValue,
		"sourceName" | "entityIdField" | "searchFields"
	>,
	input: { readonly searchText?: string | undefined } = {},
): Result.Result<PreparedRecipe<number>, Error> =>
	Result.flatMap(getNamedRowsQuery(queryDocument, settings.sourceName), (query) => {
		const selection = query.output.fields.find(
			(fieldSelection): fieldSelection is FieldSelection =>
				"key" in fieldSelection && fieldSelection.key === settings.entityIdField,
		);
		if (!selection) {
			return Result.fail(
				new Error(`Entity-browser ID field '${settings.entityIdField}' is missing or unusable`),
			);
		}
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
					where: combineWhere(query.where, search),
					measures: {
						total: selectedMeasure(
							{ expr: selection.expr, function: "countDistinct" },
							Schema.Number,
						),
					},
				}),
			},
		}));
		return Result.succeed(recipe());
	});

export const ResultsTablePageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	settings: ResultsTableSavedViewSettings,
	view: Schema.NullOr(SavedViewPageIdentity),
	target: Schema.Struct({ slug: Schema.String, kind: Schema.Literal("saved-view") }),
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

const isJsonRecord = (value: JsonValueType): value is Readonly<Record<string, JsonValueType>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const typedKeyPart = (value: JsonValueType): JsonValueType => {
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
