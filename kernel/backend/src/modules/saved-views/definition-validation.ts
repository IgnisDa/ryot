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
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { ClientRendererId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
} from "#lib/property-schema/property-schema-runtime";
import { getCatalogTable } from "#modules/ryotql/catalog";
import { validateRyotQLDocument } from "#modules/ryotql/validator";

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

type CustomRendererRecord = {
	readonly id: string;
	readonly publishedRevision: number | null;
	readonly publishedDefinition: { readonly settingsSchema: AppSchema } | null;
};

type PluginPageRecord = { readonly settingsSchema: AppSchema };

export const validateSavedViewDefinition = Effect.fn("validateSavedViewDefinition")(function* (
	renderer: SavedViewRenderer,
	settings: Readonly<Record<string, unknown>>,
	dataSources: RyotQLDocument | null,
	customRenderer: CustomRendererRecord | null,
	pluginPage: PluginPageRecord | null = null,
) {
	if (renderer.kind === "kernel" && renderer.name === "entity-browser") {
		yield* validateEntityBrowserSavedViewDefinition({ settings, dataSources });
		return null;
	}
	if (renderer.kind === "kernel" && renderer.name === "results-table") {
		yield* validateResultsTableSavedViewDefinition({ settings, dataSources });
		return null;
	}
	if (dataSources !== null) {
		const semanticError = validateRyotQLDocument(dataSources);
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
