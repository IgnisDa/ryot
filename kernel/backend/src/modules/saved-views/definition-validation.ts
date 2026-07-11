import type {
	FieldSelection,
	NamedQuery,
	Predicate,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewBadRequest,
	type SavedViewLayouts,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { Effect, Result, Schema } from "effect";

import { validateSavedViewLayouts } from "#modules/definition-registry/service";
import { getCatalogTable } from "#modules/ryotql/catalog";
import { validateRyotQLDocument } from "#modules/ryotql/validator";

type SavedViewDefinitionInput = {
	readonly layouts: SavedViewLayouts;
};

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	input: SavedViewDefinitionInput,
) {
	const validationIssue = validateSavedViewLayouts(input);
	if (validationIssue) {
		return yield* new SavedViewBadRequest({
			reason: {
				code: "invalid-definition",
				issue: validationIssue.issue,
				layout: validationIssue.layout,
				...(validationIssue.field === undefined ? {} : { field: validationIssue.field }),
			},
		});
	}
	return yield* Effect.void;
});

const invalidEntityBrowserDefinition = (message: string) =>
	new SavedViewBadRequest({ reason: { code: "settings-incompatible", message } });

const queryScope = (query: NamedQuery) => {
	const scope = new Map<string, NonNullable<ReturnType<typeof getCatalogTable>>>();
	for (const reference of [query.from, ...(query.joins ?? []).map(({ table }) => table)]) {
		const table = getCatalogTable(reference.table);
		if (table) {
			scope.set(reference.alias, table);
		}
	}
	return scope;
};

const projectedField = (query: NamedQuery, key: string) =>
	query.output.type === "rows"
		? query.output.fields.find(
				(selection): selection is FieldSelection => "key" in selection && selection.key === key,
			)
		: undefined;

const hasFixedEntityValue = (
	predicate: Predicate | undefined,
	tableAlias: string,
	field: "entitySchemaPluginId" | "entitySchemaSlug",
	value: string,
): boolean => {
	if (predicate?.type === "and") {
		return predicate.predicates.some((part) => hasFixedEntityValue(part, tableAlias, field, value));
	}
	if (predicate?.type !== "comparison" || predicate.operator !== "eq") {
		return false;
	}
	const matches = (left: typeof predicate.left, right: typeof predicate.right) =>
		left.type === "column" &&
		left.tableAlias === tableAlias &&
		left.field === field &&
		right.type === "literal" &&
		right.value === value;
	return matches(predicate.left, predicate.right) || matches(predicate.right, predicate.left);
};

export const validateEntityBrowserSavedViewDefinition = Effect.fn(
	"validateEntityBrowserSavedViewDefinition",
)(function* (input: {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly dataSources: RyotQLDocument | null;
}) {
	const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(input.settings);
	if (Result.isFailure(decoded)) {
		return yield* invalidEntityBrowserDefinition("Invalid entity-browser settings");
	}
	const settings = decoded.success;
	if (new Set(settings.layouts).size !== settings.layouts.length) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser layouts must not contain duplicates",
		);
	}
	if (!settings.layouts.includes(settings.defaultLayout)) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser defaultLayout must be one of the enabled layouts",
		);
	}
	if (settings.layouts.includes("table") !== (settings.tableColumns !== null)) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser table layout requires tableColumns and tableColumns require the table layout",
		);
	}
	if (new Set(settings.searchFields).size !== settings.searchFields.length) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser searchFields must not contain duplicates",
		);
	}
	const sortNames = settings.sortChoices.map(({ name }) => name);
	if (new Set(sortNames).size !== sortNames.length) {
		return yield* invalidEntityBrowserDefinition("Entity-browser sort choice names must be unique");
	}
	if (input.dataSources === null) {
		return yield* invalidEntityBrowserDefinition("Entity-browser dataSources are required");
	}
	const semanticError = validateRyotQLDocument(input.dataSources);
	if (semanticError) {
		return yield* invalidEntityBrowserDefinition(semanticError);
	}
	for (const [name, query] of Object.entries(input.dataSources.queries)) {
		if (query.output.type === "rows" && "after" in query.output.pagination) {
			return yield* invalidEntityBrowserDefinition(
				`Stored data source '${name}' must not contain a cursor`,
			);
		}
	}
	const query = input.dataSources.queries[settings.sourceName];
	if (!query) {
		return yield* invalidEntityBrowserDefinition(
			`Entity-browser source '${settings.sourceName}' does not exist`,
		);
	}
	if (query.output.type !== "rows") {
		return yield* invalidEntityBrowserDefinition(
			`Entity-browser source '${settings.sourceName}' must produce rows`,
		);
	}

	const expectedFields = [
		[settings.entityIdField, "id"],
		[settings.ownerPluginIdField, "entitySchemaPluginId"],
		[settings.entitySchemaSlugField, "entitySchemaSlug"],
	] as const;
	const scope = queryScope(query);
	let entityAlias: string | undefined;
	for (const [outputField, canonicalField] of expectedFields) {
		const selection = projectedField(query, outputField);
		if (
			selection?.expr.type !== "column" ||
			scope.get(selection.expr.tableAlias)?.name !== "entity" ||
			selection.expr.field !== canonicalField
		) {
			return yield* invalidEntityBrowserDefinition(
				`Entity-browser field '${outputField}' must project entity.${canonicalField}`,
			);
		}
		entityAlias ??= selection.expr.tableAlias;
		if (selection.expr.tableAlias !== entityAlias) {
			return yield* invalidEntityBrowserDefinition(
				"Entity-browser provenance fields must come from the same entity table alias",
			);
		}
	}
	if (
		settings.addAction !== null &&
		(entityAlias === undefined ||
			!hasFixedEntityValue(
				query.where,
				entityAlias,
				"entitySchemaPluginId",
				settings.addAction.ownerPluginId,
			) ||
			!hasFixedEntityValue(
				query.where,
				entityAlias,
				"entitySchemaSlug",
				settings.addAction.entitySchemaSlug,
			))
	) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser addAction must match the fixed source entity owner and schema",
		);
	}
	const configuredFields = [
		...settings.searchFields,
		...settings.sortChoices.flatMap(({ orderBy }) => orderBy.map(({ field }) => field)),
		...(settings.tableColumns?.map(({ field }) => field) ?? []),
	];
	for (const field of configuredFields) {
		if (!projectedField(query, field)) {
			return yield* invalidEntityBrowserDefinition(
				`Entity-browser configured field '${field}' must be a projected scalar field`,
			);
		}
	}
	return undefined;
});

const invalidResultsTableDefinition = (message: string) =>
	new SavedViewBadRequest({ reason: { code: "settings-incompatible", message } });

export const validateResultsTableSavedViewDefinition = Effect.fn(
	"validateResultsTableSavedViewDefinition",
)(function* (input: {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly dataSources: RyotQLDocument | null;
}) {
	const decoded = Schema.decodeUnknownResult(ResultsTableSavedViewSettings)(input.settings);
	if (Result.isFailure(decoded)) {
		return yield* invalidResultsTableDefinition("Invalid results-table settings");
	}
	const settings = decoded.success;
	if (input.dataSources === null) {
		return yield* invalidResultsTableDefinition("Results-table dataSources are required");
	}
	const semanticError = validateRyotQLDocument(input.dataSources);
	if (semanticError) {
		return yield* invalidResultsTableDefinition(semanticError);
	}
	for (const [name, query] of Object.entries(input.dataSources.queries)) {
		if (query.output.type === "rows" && "after" in query.output.pagination) {
			return yield* invalidResultsTableDefinition(
				`Stored data source '${name}' must not contain a cursor`,
			);
		}
	}
	const query = input.dataSources.queries[settings.sourceName];
	if (!query) {
		return yield* invalidResultsTableDefinition(
			`Results-table source '${settings.sourceName}' does not exist`,
		);
	}
	if (query.output.type !== "rows") {
		return yield* invalidResultsTableDefinition(
			`Results-table source '${settings.sourceName}' must produce rows`,
		);
	}
	const configuredFields = [
		...settings.rowKeyFields,
		...settings.columns.map(({ field }) => field),
	];
	for (const field of configuredFields) {
		if (!projectedField(query, field)) {
			return yield* invalidResultsTableDefinition(
				`Results-table field '${field}' must be a projected scalar field`,
			);
		}
	}
	if (settings.entityLink) {
		const field = projectedField(query, settings.entityLink.entityIdField);
		const scope = queryScope(query);
		const sourceTable =
			field?.expr.type === "column" ? scope.get(field.expr.tableAlias) : undefined;
		if (
			field?.expr.type !== "column" ||
			!(
				(sourceTable?.name === "entity" && field.expr.field === "id") ||
				(sourceTable?.name === "event" && field.expr.field === "entityId")
			)
		) {
			return yield* invalidResultsTableDefinition(
				`Results-table entity link field '${settings.entityLink.entityIdField}' must project entity.id`,
			);
		}
	}
	return undefined;
});
