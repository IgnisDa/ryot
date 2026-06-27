import type {
	FieldSelection,
	NamedQuery,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
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
	return undefined;
});
