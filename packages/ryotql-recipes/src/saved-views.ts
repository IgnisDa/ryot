import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import { SavedViewClientPageTarget } from "@ryot-app/contract/modules/pages/schemas";
import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import {
	type FieldSelection,
	type OrderBy,
	type Predicate,
	rowsResultSchema,
	RyotQLDocument,
	type ScalarExpression,
	type TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
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
import {
	and,
	ascending,
	castText,
	column,
	conditional,
	contains,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	field,
	literal,
	or,
	type PreparedRecipe,
	rows,
	selectedAggregate,
	selectedMeasure,
	startsWith,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

import {
	compileOptionalFilter,
	effectiveFilterFields,
	type FilterInput,
	type RowsQuery,
} from "./filters";

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
	if ((displayKind === "number" || displayKind === "year") && typeof value === "number") {
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

type EntityBrowserRecipeInput = FilterInput & {
	readonly after?: string | undefined;
	readonly pageSize?: number | undefined;
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

export const unusedFieldKey = (fields: readonly FieldSelection[], base: string) => {
	const keys = new Set(fields.map(({ key }) => key));
	let key = base;
	while (keys.has(key)) {
		key = `_${key}`;
	}
	return key;
};

const selectedFields = (source: RowsQuery) =>
	source.output.fields.flatMap((selection) => ("key" in selection ? [selection] : []));

const searchExpressions = (
	source: RowsQuery,
	settings: Pick<EntityBrowserSavedViewSettingsValue, "searchFields">,
): Result.Result<readonly ScalarExpression[], Error> => {
	const fields = selectedFields(source);
	const expressions: ScalarExpression[] = [];
	for (const key of settings.searchFields) {
		const selection = fields.find((candidate) => candidate.key === key);
		if (!selection) {
			return Result.fail(new Error(`Entity-browser search field '${key}' is missing or unusable`));
		}
		expressions.push(castText(selection.expr));
	}
	return Result.succeed(expressions);
};

const browserSearchPredicate = (
	source: RowsQuery,
	settings: Pick<EntityBrowserSavedViewSettingsValue, "searchFields">,
	searchText: string | undefined,
): Result.Result<Predicate | undefined, Error> => {
	if (searchText === undefined || searchText.length === 0) {
		return Result.succeed(undefined);
	}
	return Result.map(searchExpressions(source, settings), (expressions) =>
		expressions.length === 0
			? undefined
			: or(...expressions.map((expression) => contains(expression, literal(searchText)))),
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

export const subjectSchemaPredicate = (subject: SavedViewSubject, entity: TableReference) =>
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
		const filterResult = compileOptionalFilter(input, {
			source,
			subject: input.settings.subject,
			fields: effectiveFilterFields("entity-browser", input.settings),
		});
		if (Result.isFailure(filterResult)) {
			return Result.fail(filterResult.failure);
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
				combineWhere(
					combineWhere(source.where, subjectSchemaPredicate(input.settings.subject, entity)),
					search,
				),
				filterResult.success,
			),
			output: {
				...source.output,
				orderBy,
				pagination: {
					limit: input.pageSize ?? input.settings.pageSize,
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
	settings: Pick<
		EntityBrowserSavedViewSettingsValue,
		"sourceName" | "subject" | "searchFields" | "filterFields"
	>,
	input: FilterInput & { readonly searchText?: string | undefined } = {},
): Result.Result<PreparedRecipe<number>, Error> =>
	Result.flatMap(getNamedRowsQuery(queryDocument, settings.sourceName), (query) => {
		const entity = table("entity", settings.subject.entityAlias);
		const searchResult = browserSearchPredicate(query, settings, input.searchText);
		if (Result.isFailure(searchResult)) {
			return Result.fail(searchResult.failure);
		}
		const filterResult = compileOptionalFilter(input, {
			source: query,
			subject: settings.subject,
			fields: effectiveFilterFields("entity-browser", settings),
		});
		if (Result.isFailure(filterResult)) {
			return Result.fail(filterResult.failure);
		}
		const search = searchResult.success;
		const recipe = defineRecipe(() => ({
			map: ({ entityBrowserCount }) => Result.succeed(entityBrowserCount.total),
			queries: {
				entityBrowserCount: selectedAggregate(query.from, {
					joins: query.joins,
					measures: {
						total: selectedMeasure(
							{ function: "countDistinct", expr: column(entity, "id") },
							Schema.Finite,
						),
					},
					where: combineWhere(
						combineWhere(
							combineWhere(query.where, subjectSchemaPredicate(settings.subject, entity)),
							search,
						),
						filterResult.success,
					),
				}),
			},
		}));
		return Result.succeed(recipe());
	});

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

const summaryExpression = (source: RowsQuery, key: string | null) => {
	if (key === null) {
		return Result.succeed(null);
	}
	const selection = selectedFields(source).find((candidate) => candidate.key === key);
	return selection
		? Result.succeed(selection.expr)
		: Result.fail(new Error(`Entity-browser summary field '${key}' is missing or unusable`));
};

const decodeLibrarySearchHit = (
	row: SavedViewRawRow,
	summary: EntityBrowserSavedViewSettingsValue["summary"],
) =>
	Result.gen(function* () {
		const image =
			summary.image === null
				? null
				: yield* Result.flatMap(rawField(row, "image"), (value) =>
						value === null ? Result.succeed(null) : Schema.decodeUnknownResult(AssetLocator)(value),
					);
		const subtitleKind = summary.subtitle?.displayKind;
		const subtitle =
			subtitleKind === undefined
				? null
				: yield* Result.flatMap(rawField(row, "subtitle"), (value) =>
						displayValue(value, subtitleKind, "subtitle"),
					);
		return {
			image,
			subtitle,
			name: yield* textField(row, "name"),
			entityId: yield* textField(row, "entityId"),
			rank: yield* Result.flatMap(rawField(row, "rank"), (value) =>
				Schema.decodeUnknownResult(Schema.Finite)(value),
			),
		};
	});

export const librarySearchRecipe = (input: {
	readonly limit: number;
	readonly searchText: string;
	readonly queryDocument: RyotQLDocument;
	readonly settings: EntityBrowserSavedViewSettingsValue;
}): Result.Result<PreparedRecipe<LibrarySearchResult>, Error> =>
	Result.flatMap(getNamedRowsQuery(input.queryDocument, input.settings.sourceName), (source) =>
		Result.gen(function* () {
			const expressions = yield* searchExpressions(source, input.settings);
			if (expressions.length === 0) {
				return yield* Result.fail(new Error("Library search requires declared search fields"));
			}
			const image = yield* summaryExpression(source, input.settings.summary.image);
			const subtitle = yield* summaryExpression(
				source,
				input.settings.summary.subtitle?.field ?? null,
			);
			const entity = table("entity", input.settings.subject.entityAlias);
			const matching = (predicate: typeof contains, text: string) =>
				or(...expressions.map((expression) => predicate(expression, literal(text))));
			const rank = conditional(
				matching(startsWith, input.searchText),
				literal(0),
				conditional(matching(contains, ` ${input.searchText}`), literal(1), literal(2)),
			);
			const where = combineWhere(
				combineWhere(source.where, subjectSchemaPredicate(input.settings.subject, entity)),
				matching(contains, input.searchText),
			);
			const hits = rows(source.from, {
				where,
				limit: input.limit,
				joins: source.joins,
				orderBy: [ascending(rank), ...source.output.orderBy, ascending(column(entity, "id"))],
				fields: [
					field("entityId", column(entity, "id")),
					field("name", column(entity, "name")),
					field("rank", rank),
					...(image === null ? [] : [field("image", image)]),
					...(subtitle === null ? [] : [field("subtitle", subtitle)]),
				],
			});
			const recipe = defineRecipe(() => ({
				map: ({ total, hits: found }) => Result.succeed({ hits: found, total: total.total }),
				queries: {
					total: selectedAggregate(source.from, {
						where,
						joins: source.joins,
						measures: {
							total: selectedMeasure(
								{ function: "countDistinct", expr: column(entity, "id") },
								Schema.Finite,
							),
						},
					}),
					hits: {
						document: hits,
						decodeResult: (result: unknown) =>
							Result.flatMap(Schema.decodeUnknownResult(savedViewRows)(result), ({ items }) =>
								Result.gen(function* () {
									const decoded = yield* Result.all(
										items.map((row) => decodeLibrarySearchHit(row, input.settings.summary)),
									);
									if (new Set(decoded.map(({ entityId }) => entityId)).size !== decoded.length) {
										return yield* Result.fail(
											new Error("Library search page contains duplicate entity IDs"),
										);
									}
									return decoded;
								}),
							),
					},
				},
			}));
			return recipe();
		}),
	);

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

type ResultsTableRecipeInput = FilterInput & {
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
	Result.flatMap(getNamedRowsQuery(input.queryDocument, input.settings.sourceName), (source) => {
		const filterResult = compileOptionalFilter(input, {
			source,
			subject: undefined,
			fields: effectiveFilterFields("results-table", input.settings),
		});
		if (Result.isFailure(filterResult)) {
			return Result.fail(filterResult.failure);
		}
		const query = {
			...source,
			where: combineWhere(source.where, filterResult.success),
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
		return Result.succeed(recipe());
	});
