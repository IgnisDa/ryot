import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type {
	FieldSelection,
	NamedQuery,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewBadRequest,
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { ClientRendererId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#modules/definitions/properties/runtime";
import { filterFieldIssues } from "#modules/definitions/saved-view-filters";
import { getCatalogTable, jsonElementsTable } from "#modules/ryotql/catalog";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const invalidEntityBrowserDefinition = (message: string) =>
	new SavedViewBadRequest({ reason: { message, code: "settings-incompatible" } });

const queryScope = (query: NamedQuery) => {
	const scope = new Map<string, NonNullable<ReturnType<typeof getCatalogTable>>>();
	const root = getCatalogTable(query.from.table);
	if (root) {
		scope.set(query.from.alias, root);
	}
	for (const join of query.joins ?? []) {
		if (join.type === "jsonElements") {
			scope.set(join.alias, jsonElementsTable);
			continue;
		}
		const table = getCatalogTable(join.table.table);
		if (table) {
			scope.set(join.table.alias, table);
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
	const semanticError = validateRyotQLDocument(input.dataSources, savedViewDataSourceAccess);
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

	if (queryScope(query).get(settings.subject.entityAlias)?.name !== "entity") {
		return yield* invalidEntityBrowserDefinition(
			`Entity-browser subject alias '${settings.subject.entityAlias}' must be an entity table in the source query`,
		);
	}
	const subjectKeys = settings.subject.schemas.map(({ slug, owner }) =>
		definitionKey("entity", owner, slug),
	);
	if (new Set(subjectKeys).size !== subjectKeys.length) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser subject schemas must not contain duplicates",
		);
	}
	if (
		settings.addAction?.type === "provider-search" &&
		!subjectKeys.includes(
			definitionKey("entity", settings.addAction.schema.owner, settings.addAction.schema.slug),
		)
	) {
		return yield* invalidEntityBrowserDefinition(
			"Entity-browser addAction schema must be one of the subject schemas",
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
	const filterIssue = filterFieldIssues({ query, settings, renderer: "entity-browser" });
	if (filterIssue) {
		return yield* invalidEntityBrowserDefinition(filterIssue);
	}
	return undefined;
});

const invalidResultsTableDefinition = (message: string) =>
	new SavedViewBadRequest({ reason: { message, code: "settings-incompatible" } });

type CustomRendererRecord = {
	readonly id: string;
	readonly publishedRevision: number | null;
	readonly publishedDefinition: { readonly settingsSchema: AppSchema } | null;
};

type PluginPageRecord = { readonly settingsSchema: AppSchema };

export const isEntityBrowserRenderer = (renderer: {
	readonly kind: string;
	readonly name?: string;
}) =>
	renderer.kind === "kernel" &&
	(renderer.name === "entity-browser" || renderer.name === "collection-browser");

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	renderer: SavedViewRenderer,
	settings: Readonly<Record<string, unknown>>,
	dataSources: RyotQLDocument | null,
	customRenderer: CustomRendererRecord | null,
	pluginPage: PluginPageRecord | null = null,
) {
	if (isEntityBrowserRenderer(renderer)) {
		yield* validateEntityBrowserSavedViewDefinition({ settings, dataSources });
		return null;
	}
	if (renderer.kind === "kernel" && renderer.name === "results-table") {
		yield* validateResultsTableSavedViewDefinition({ settings, dataSources });
		return null;
	}
	if (dataSources !== null) {
		const semanticError = validateRyotQLDocument(dataSources, savedViewDataSourceAccess);
		if (semanticError) {
			return yield* invalidResultsTableDefinition(semanticError);
		}
		for (const [name, query] of Object.entries(dataSources.queries)) {
			if (query.output.type === "rows" && "after" in query.output.pagination) {
				return yield* invalidResultsTableDefinition(
					`Stored data source '${name}' must not contain a cursor`,
				);
			}
		}
	}
	if (renderer.kind === "plugin") {
		if (!pluginPage) {
			return yield* new SavedViewBadRequest({ reason: { code: "renderer-not-found" } });
		}
		yield* parseAppSchemaProperties({
			properties: settings,
			kind: "Saved view settings",
			propertiesSchema: pluginPage.settingsSchema,
		}).pipe(
			Effect.mapError(
				(error) =>
					new SavedViewBadRequest({
						reason: { code: "settings-incompatible", message: formatPropertyIssues(error.issues) },
					}),
			),
		);
		return null;
	}
	if (!customRenderer) {
		return yield* new SavedViewBadRequest({ reason: { code: "renderer-not-found" } });
	}
	if (!customRenderer.publishedDefinition || customRenderer.publishedRevision === null) {
		return yield* new SavedViewBadRequest({ reason: { code: "renderer-unpublished" } });
	}
	yield* parseAppSchemaProperties({
		properties: settings,
		kind: "Saved view settings",
		propertiesSchema: customRenderer.publishedDefinition.settingsSchema,
	}).pipe(
		Effect.mapError(
			(error) =>
				new SavedViewBadRequest({
					reason: { code: "settings-incompatible", message: formatPropertyIssues(error.issues) },
				}),
		),
	);
	return ClientRendererId.make(customRenderer.id);
});

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
	const semanticError = validateRyotQLDocument(input.dataSources, savedViewDataSourceAccess);
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
	const filterIssue = filterFieldIssues({ query, settings, renderer: "results-table" });
	if (filterIssue) {
		return yield* invalidResultsTableDefinition(filterIssue);
	}
	return undefined;
});
