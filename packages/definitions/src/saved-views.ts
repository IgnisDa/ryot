import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type * as Authored from "@ryot-app/contract/modules/ryotql/authored";
import type {
	FieldSelection,
	NamedQuery,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	type SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { formatPropertyIssues } from "@ryot-app/contract/schema/property-validation";
import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import type { ControlSchema } from "@ryot-app/ryotql-recipes/controls";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "@ryot-app/ryotql/validator";
import { Result, Schema } from "effect";

import {
	entityBrowserConfiguredFields,
	resultsTableConfiguredFields,
	unprojectedField,
} from "./saved-view-filters";

export type SavedViewIssue =
	| { readonly code: "renderer-not-found" }
	| { readonly message: string; readonly code: "settings-incompatible" };

type Settings = Readonly<Record<string, unknown>>;

type PluginPage = { readonly settingsSchema: AppSchema };

type SourceOptions = {
	/** Calendar and analytics views exist only as kernel-owned built-ins. */
	readonly kernelBuiltin: boolean;
};

const incompatible = (message: string): SavedViewIssue => ({
	message,
	code: "settings-incompatible",
});

export const savedViewIssueMessage = (issue: SavedViewIssue) =>
	issue.code === "renderer-not-found" ? "renderer is not an advertised page export" : issue.message;

export const isEntityBrowserRenderer = (renderer: {
	readonly kind: string;
	readonly name?: string;
}) =>
	renderer.kind === "kernel" &&
	(renderer.name === "entity-browser" || renderer.name === "collection-browser");

const storedDataSourcesIssue = (dataSources: RyotQLDocument) => {
	const { error } = validateRyotQLDocument(dataSources, savedViewDataSourceAccess);
	if (error) {
		return incompatible(error);
	}
	for (const [name, query] of Object.entries(dataSources.queries)) {
		if (query.output.type === "rows" && "after" in query.output.pagination) {
			return incompatible(`Stored data source '${name}' must not contain a cursor`);
		}
	}
	return undefined;
};

const queryScope = (query: NamedQuery) => {
	const scope = new Map<string, string>([[query.from.alias, query.from.table]]);
	for (const join of query.joins ?? []) {
		if (join.type !== "jsonElements") {
			scope.set(join.table.alias, join.table.table);
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

const entityBrowserIssue = (settingsInput: Settings, dataSources: null | RyotQLDocument) => {
	const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(settingsInput);
	if (Result.isFailure(decoded)) {
		return incompatible("Invalid entity-browser settings");
	}
	const settings = decoded.success;
	if (new Set(settings.layouts).size !== settings.layouts.length) {
		return incompatible("Entity-browser layouts must not contain duplicates");
	}
	if (!settings.layouts.includes(settings.defaultLayout)) {
		return incompatible("Entity-browser defaultLayout must be one of the enabled layouts");
	}
	if (settings.layouts.includes("table") !== (settings.tableColumns !== null)) {
		return incompatible(
			"Entity-browser table layout requires tableColumns and tableColumns require the table layout",
		);
	}
	if (dataSources === null) {
		return incompatible("Entity-browser dataSources are required");
	}
	const sourceIssue = storedDataSourcesIssue(dataSources);
	if (sourceIssue) {
		return sourceIssue;
	}
	const query = dataSources.queries[settings.sourceName];
	if (!query) {
		return incompatible(`Entity-browser source '${settings.sourceName}' does not exist`);
	}
	if (query.output.type !== "rows") {
		return incompatible(`Entity-browser source '${settings.sourceName}' must produce rows`);
	}
	if (queryScope(query).get(settings.subject.entityAlias) !== "entity") {
		return incompatible(
			`Entity-browser subject alias '${settings.subject.entityAlias}' must be an entity table in the source query`,
		);
	}
	const subjectKeys = settings.subject.schemas.map(({ slug, owner }) =>
		definitionKey("entity", owner, slug),
	);
	if (new Set(subjectKeys).size !== subjectKeys.length) {
		return incompatible("Entity-browser subject schemas must not contain duplicates");
	}
	if (
		settings.addAction?.type === "provider-search" &&
		!subjectKeys.includes(
			definitionKey("entity", settings.addAction.schema.owner, settings.addAction.schema.slug),
		)
	) {
		return incompatible("Entity-browser addAction schema must be one of the subject schemas");
	}
	const unprojected = unprojectedField(query, entityBrowserConfiguredFields(settings));
	if (unprojected !== undefined) {
		return incompatible(
			`Entity-browser configured field '${unprojected}' must be a projected scalar field`,
		);
	}
	return undefined;
};

const resultsTableIssue = (settingsInput: Settings, dataSources: null | RyotQLDocument) => {
	const decoded = Schema.decodeUnknownResult(ResultsTableSavedViewSettings)(settingsInput);
	if (Result.isFailure(decoded)) {
		return incompatible("Invalid results-table settings");
	}
	const settings = decoded.success;
	if (dataSources === null) {
		return incompatible("Results-table dataSources are required");
	}
	const sourceIssue = storedDataSourcesIssue(dataSources);
	if (sourceIssue) {
		return sourceIssue;
	}
	const query = dataSources.queries[settings.sourceName];
	if (!query) {
		return incompatible(`Results-table source '${settings.sourceName}' does not exist`);
	}
	if (query.output.type !== "rows") {
		return incompatible(`Results-table source '${settings.sourceName}' must produce rows`);
	}
	const unprojected = unprojectedField(query, resultsTableConfiguredFields(settings));
	if (unprojected !== undefined) {
		return incompatible(`Results-table field '${unprojected}' must be a projected scalar field`);
	}
	if (settings.entityLink) {
		const field = projectedField(query, settings.entityLink.entityIdField);
		const sourceTable =
			field?.expr.type === "column" ? queryScope(query).get(field.expr.tableAlias) : undefined;
		if (
			field?.expr.type !== "column" ||
			!(
				(sourceTable === "entity" && field.expr.field === "id") ||
				(sourceTable === "event" && field.expr.field === "entityId")
			)
		) {
			return incompatible(
				`Results-table entity link field '${settings.entityLink.entityIdField}' must project entity.id`,
			);
		}
	}
	return undefined;
};

export const pluginPageSettingsIssue = (
	settings: Settings,
	page: null | PluginPage,
): undefined | SavedViewIssue => {
	if (!page) {
		return { code: "renderer-not-found" };
	}
	const parsed = parseAppSchemaPropertiesSafe({
		properties: settings,
		kind: "Saved view settings",
		propertiesSchema: page.settingsSchema,
	});
	return parsed.success ? undefined : incompatible(formatPropertyIssues(parsed.issues));
};

export const savedViewSourceIssue = (
	renderer: SavedViewRenderer,
	settings: Settings,
	dataSources: null | RyotQLDocument,
	options: SourceOptions,
): undefined | SavedViewIssue => {
	if (renderer.kind === "page") {
		return dataSources !== null || Object.keys(settings).length !== 0
			? incompatible("Page views require no data sources and empty settings")
			: undefined;
	}
	if (renderer.kind === "plugin") {
		return dataSources === null ? undefined : storedDataSourcesIssue(dataSources);
	}
	switch (renderer.name) {
		case "calendar":
		case "analytics":
			if (!options.kernelBuiltin) {
				return incompatible(
					`${renderer.name === "calendar" ? "Calendar" : "Analytics"} views are kernel built-ins only`,
				);
			}
			return dataSources !== null || Object.keys(settings).length > 0
				? incompatible(`${renderer.name} views take no settings or data sources`)
				: undefined;
		case "results-table":
			return resultsTableIssue(settings, dataSources);
		case "entity-browser":
		case "collection-browser":
			return entityBrowserIssue(settings, dataSources);
		default:
			return renderer.name satisfies never;
	}
};

export const validateSavedViewDefinition = (input: {
	readonly settings: Settings;
	readonly options: SourceOptions;
	readonly renderer: SavedViewRenderer;
	readonly pluginPage: null | PluginPage;
	readonly schemas: readonly ControlSchema[];
	readonly dataSources: null | Authored.RyotQLDocument;
}): Result.Result<readonly RyotQLDocument[], SavedViewIssue> => {
	const { options, renderer, settings } = input;
	if (renderer.kind === "plugin") {
		const issue = pluginPageSettingsIssue(settings, input.pluginPage);
		if (issue) {
			return Result.fail(issue);
		}
	}
	if (input.dataSources === null) {
		const issue = savedViewSourceIssue(renderer, settings, null, options);
		return issue ? Result.fail(issue) : Result.succeed([]);
	}
	const branches = storedValidationBranches(input.dataSources, input.schemas);
	if (Result.isFailure(branches)) {
		return Result.fail(incompatible(branches.failure.message));
	}
	for (const branch of branches.success) {
		const issue = savedViewSourceIssue(renderer, settings, branch, options);
		if (issue) {
			return Result.fail(issue);
		}
	}
	return Result.succeed(branches.success);
};
