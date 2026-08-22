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

type DisplayExpression = {
	readonly expression: ScalarExpression;
	readonly displayKind: SavedViewDisplayKind;
};

type SavedViewValueMapping = {
	readonly field: string;
	readonly displayKind: SavedViewDisplayKind;
};

export type SavedViewCardMapping = {
	readonly titleField: string;
	readonly imageField: string | null;
	readonly callout: SavedViewValueMapping | null;
	readonly overline: SavedViewValueMapping | null;
	readonly primaryMetadata: SavedViewValueMapping | null;
	readonly secondaryMetadata: SavedViewValueMapping | null;
};

export type SavedViewTableMapping = {
	readonly imageField: string | null;
	readonly columns: readonly [SavedViewTableColumn, ...SavedViewTableColumn[]];
};

type CardExpressions = {
	readonly title: ScalarExpression;
	readonly image: ScalarExpression | null;
	readonly callout: DisplayExpression | null;
	readonly overline: DisplayExpression | null;
	readonly primaryMetadata: DisplayExpression | null;
	readonly secondaryMetadata: DisplayExpression | null;
};

type TableColumnExpression = Omit<SavedViewTableMapping["columns"][number], "field"> & {
	readonly expression: ScalarExpression;
};

type CardProjectionInput = {
	readonly card: CardExpressions;
	readonly entity: TableReference;
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

export type SavedViewLayoutProjectionsInput = {
	readonly grid: CardProjectionInput;
	readonly list: CardProjectionInput;
	readonly table: TableProjectionInput;
};

const cardProjection = (input: CardProjectionInput) => {
	const title = "title";
	const image = "image";
	const callout = "callout";
	const entityId = "entityId";
	const overline = "overline";
	const primaryMetadata = "primaryMetadata";
	const secondaryMetadata = "secondaryMetadata";
	return {
		fields: [
			field(entityId, column(input.entity, "id")),
			field(title, input.card.title),
			...(input.card.image === null ? [] : [field(image, input.card.image)]),
			...(input.card.overline === null ? [] : [field(overline, input.card.overline.expression)]),
			...(input.card.callout === null ? [] : [field(callout, input.card.callout.expression)]),
			...(input.card.primaryMetadata === null
				? []
				: [field(primaryMetadata, input.card.primaryMetadata.expression)]),
			...(input.card.secondaryMetadata === null
				? []
				: [field(secondaryMetadata, input.card.secondaryMetadata.expression)]),
			...syncSelections(input.entity),
		] satisfies readonly FieldSelection[],
		mappings: {
			titleField: title,
			entityIdField: entityId,
			imageField: input.card.image === null ? null : image,
			callout:
				input.card.callout === null
					? null
					: { field: callout, displayKind: input.card.callout.displayKind },
			overline:
				input.card.overline === null
					? null
					: { field: overline, displayKind: input.card.overline.displayKind },
			primaryMetadata:
				input.card.primaryMetadata === null
					? null
					: { field: primaryMetadata, displayKind: input.card.primaryMetadata.displayKind },
			secondaryMetadata:
				input.card.secondaryMetadata === null
					? null
					: { field: secondaryMetadata, displayKind: input.card.secondaryMetadata.displayKind },
		} satisfies SavedViewCardMapping & { readonly entityIdField: string },
	};
};

const tableProjection = (input: TableProjectionInput) => {
	const entityId = "entityId";
	const image = "image";
	const [firstTableColumn, ...remainingTableColumns] = input.columns;
	const columns = [
		{
			field: "column0",
			label: firstTableColumn.label,
			displayKind: firstTableColumn.displayKind,
		},
		...remainingTableColumns.map((tableColumn, index) => ({
			label: tableColumn.label,
			field: `column${index + 1}`,
			displayKind: tableColumn.displayKind,
		})),
	] as const;

	return {
		fields: [
			field(entityId, column(input.entity, "id")),
			...(input.image === null ? [] : [field(image, input.image)]),
			...input.columns.map((tableColumn, index) => field(`column${index}`, tableColumn.expression)),
			...syncSelections(input.entity),
		] satisfies readonly FieldSelection[],
		mappings: {
			columns,
			entityIdField: entityId,
			imageField: input.image === null ? null : image,
		} satisfies SavedViewTableMapping & { readonly entityIdField: string },
	};
};

export const buildSavedViewLayoutProjections = (input: SavedViewLayoutProjectionsInput) => ({
	grid: cardProjection(input.grid),
	list: cardProjection(input.list),
	table: tableProjection(input.table),
});

type SavedViewMapping =
	| {
			readonly type: "card";
			readonly mapping: SavedViewCardMapping & { readonly entityIdField: string };
	  }
	| {
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

type SavedViewCardRecipeInput = {
	readonly layout: Extract<SavedViewMapping, { readonly type: "card" }>;
	readonly source: SavedViewGeneratedSource | SavedViewPersistedSource;
};

type SavedViewTableRecipeInput = {
	readonly layout: Extract<SavedViewMapping, { readonly type: "table" }>;
	readonly source: SavedViewGeneratedSource | SavedViewPersistedSource;
};

type SavedViewRecipeInput = {
	readonly layout: SavedViewMapping;
	readonly source: SavedViewGeneratedSource | SavedViewPersistedSource;
};

export type SavedViewCardResultItem = {
	readonly title: string;
	readonly entityId: string;
	readonly sync: EntitySyncStateValue;
	readonly image: AssetLocatorType | null | undefined;
	readonly callout?: SavedViewDisplayValue | undefined;
	readonly overline?: SavedViewDisplayValue | undefined;
	readonly primaryMetadata?: SavedViewDisplayValue | undefined;
	readonly secondaryMetadata?: SavedViewDisplayValue | undefined;
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
			where: input.where ? and(schemaFilter, input.where) : schemaFilter,
			orderBy: input.orderBy ?? [ascending(column(entity, "name"))],
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
		return Result.succeed({ displayKind, value } as SavedViewDisplayValue);
	}
	if (displayKind === "json") {
		return Result.succeed({ displayKind, value });
	}
	if (displayKind === "managed-asset") {
		return Result.map(Schema.decodeUnknownResult(AssetLocator)(value), (asset) => ({
			displayKind,
			value: asset,
		}));
	}
	if (displayKind === "date") {
		return typeof value === "string" && Option.isSome(DateTime.make(value))
			? Result.succeed({ displayKind, value })
			: Result.fail(new Error(`Saved-view field '${fieldName}' must be a valid date`));
	}
	if (displayKind === "text" && typeof value === "string") {
		return Result.succeed({ displayKind, value });
	}
	if (displayKind === "number" && typeof value === "number") {
		return Result.succeed({ displayKind, value });
	}
	if (displayKind === "boolean" && typeof value === "boolean") {
		return Result.succeed({ displayKind, value });
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

const optionalDisplayField = (row: SavedViewRawRow, mapping: SavedViewCardMapping["callout"]) => {
	if (mapping === null) {
		return Result.succeed(undefined);
	}
	return Result.flatMap(rawField(row, mapping.field), (value) =>
		value === null
			? Result.succeed(undefined)
			: displayValue(value, mapping.displayKind, mapping.field),
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

const cardItem = (
	row: SavedViewRawRow,
	mapping: SavedViewCardMapping & { readonly entityIdField: string },
) =>
	Result.gen(function* () {
		const sync = yield* syncField(row);
		const title = yield* textField(row, mapping.titleField);
		const entityId = yield* textField(row, mapping.entityIdField);
		const image = yield* imageField(row, mapping.imageField);
		const callout = yield* optionalDisplayField(row, mapping.callout);
		const overline = yield* optionalDisplayField(row, mapping.overline);
		const primaryMetadata = yield* optionalDisplayField(row, mapping.primaryMetadata);
		const secondaryMetadata = yield* optionalDisplayField(row, mapping.secondaryMetadata);
		return { sync, title, entityId, image, callout, overline, primaryMetadata, secondaryMetadata };
	});

const tableItem = (
	row: SavedViewRawRow,
	mapping: SavedViewTableMapping & { readonly entityIdField: string },
) =>
	Result.gen(function* () {
		const sync = yield* syncField(row);
		const entityId = yield* textField(row, mapping.entityIdField);
		const image = yield* imageField(row, mapping.imageField);
		const cells = yield* Result.all(
			mapping.columns.map(({ field: fieldName, label, displayKind }) =>
				Result.flatMap(rawField(row, fieldName), (value) =>
					Result.map(displayValue(value, displayKind, fieldName), (decoded) => ({
						label,
						key: fieldName,
						value: decoded,
					})),
				),
			),
		);
		return { sync, entityId, image, cells };
	});

const savedViewRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));

const mappedFields = (layout: SavedViewMapping) => {
	if (layout.type === "table") {
		return [
			layout.mapping.entityIdField,
			...(layout.mapping.imageField === null ? [] : [layout.mapping.imageField]),
			...layout.mapping.columns.map(({ field: fieldName }) => fieldName),
		];
	}
	return [
		layout.mapping.titleField,
		layout.mapping.entityIdField,
		...(layout.mapping.imageField === null ? [] : [layout.mapping.imageField]),
		...[
			layout.mapping.callout,
			layout.mapping.overline,
			layout.mapping.primaryMetadata,
			layout.mapping.secondaryMetadata,
		].flatMap((mapping) => (mapping === null ? [] : [mapping.field])),
	];
};

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
				Result.all(
					layout.type === "card"
						? items.map((row) => cardItem(row, layout.mapping))
						: items.map((row) => tableItem(row, layout.mapping)),
				),
				(decodedItems) => ({ items: decodedItems, pageInfo }),
			),
		),
});

export function savedViewRecipe(
	input: SavedViewCardRecipeInput,
): PreparedRecipe<SavedViewResult<SavedViewCardResultItem>>;
export function savedViewRecipe(
	input: SavedViewTableRecipeInput,
): PreparedRecipe<SavedViewResult<SavedViewTableResultItem>>;
export function savedViewRecipe(
	input: SavedViewRecipeInput,
): PreparedRecipe<SavedViewResult<SavedViewCardResultItem | SavedViewTableResultItem>>;
export function savedViewRecipe(
	input: SavedViewRecipeInput,
): PreparedRecipe<SavedViewResult<SavedViewCardResultItem | SavedViewTableResultItem>> {
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
				map: ({ savedViewCount }) => Result.succeed(savedViewCount.total),
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
		Schema.Struct({
			key: Schema.String,
			label: Schema.String,
			value: SavedViewDisplayValue,
		}),
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

export const EntityBrowserPageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	settings: EntityBrowserSavedViewSettings,
	target: Schema.Struct({ savedViewId: Schema.String }),
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
														({ field: fieldName, label, displayKind }) =>
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
													sync: yield* syncFields(row, populationField, translationField),
													entityId: yield* textField(row, input.settings.entityIdField),
													ownerPluginId: yield* nullableTextField(
														row,
														input.settings.ownerPluginIdField,
													),
													entitySchemaSlug: yield* textField(
														row,
														input.settings.entitySchemaSlugField,
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
									return { items: decoded, pageInfo };
								}),
						),
				},
			},
			map: ({ entityBrowser }) => Result.succeed(entityBrowser),
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
			map: ({ entityBrowserCount }) => Result.succeed(entityBrowserCount.total),
		}));
		return Result.succeed(recipe());
	});

export const ResultsTablePageInput = Schema.Struct({
	dataSources: RyotQLDocument,
	settings: ResultsTableSavedViewSettings,
	target: Schema.Struct({ savedViewId: Schema.String }),
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
	return { type: typeof value, value };
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
			settings.columns.map(({ field: fieldName, label, displayKind }) =>
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
		return { key: JSON.stringify(keyParts), entityId, cells };
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
									return { items: decoded, pageInfo };
								}),
						),
				},
			},
			map: ({ resultsTable }) => Result.succeed(resultsTable),
		}));
		return recipe();
	});
