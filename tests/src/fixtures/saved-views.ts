import type { ContractPayload } from "@ryot/contract/client";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { column, jsonPath, literal, table } from "@ryot/ryotql";
import { buildSavedViewDocument, buildSavedViewProjection } from "@ryot/ryotql-recipes/saved-views";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

type CreateSavedViewBody = ContractPayload<"savedViews", "create">;
type UpdateSavedViewBody = ContractPayload<"savedViews", "update">;
type ReorderSavedViewsBody = ContractPayload<"savedViews", "reorder">;

export type SavedViewQueryDocument = CreateSavedViewBody["queryDocument"];
type SavedViewDisplayConfiguration = CreateSavedViewBody["displayConfiguration"];
type CreateSavedViewInput = Partial<CreateSavedViewBody>;
type UpdateSavedViewInput = Partial<UpdateSavedViewBody>;

const entity = table("entity", "entity");
const entityProperties = column(entity, "properties");
const entityProperty = (...path: [string | number, ...(string | number)[]]) =>
	jsonPath(entityProperties, ...path);

const defaultProjection = buildSavedViewProjection({
	entityId: column(entity, "id"),
	grid: {
		title: column(entity, "name"),
		image: entityProperty("images", 0),
		eyebrow: literal("Book"),
		callout: null,
		primarySubtitle: entityProperty("publishYear"),
		secondarySubtitle: null,
	},
	list: {
		title: column(entity, "name"),
		image: entityProperty("images", 0),
		eyebrow: literal("Book"),
		callout: null,
		primarySubtitle: entityProperty("publishYear"),
		secondarySubtitle: null,
	},
	table: [
		{ label: "Name", expression: column(entity, "name") },
		{ label: "Year", expression: entityProperty("publishYear") },
	],
});

const defaultDisplayConfiguration =
	defaultProjection.displayConfiguration satisfies SavedViewDisplayConfiguration;

export const rowsDocument = buildSavedViewDocument({
	page: 1,
	limit: 2,
	entitySchemaSlugs: ["book"],
	fields: defaultProjection.fields,
}) satisfies SavedViewQueryDocument;

const rowsQuery = rowsDocument.queries.savedView;
type SavedViewFieldSelection = Extract<
	(typeof rowsQuery.output.fields)[number],
	{ readonly key: string }
>;
export const rowsFields = rowsQuery.output.fields.filter(
	(selection): selection is SavedViewFieldSelection => "key" in selection,
);

export function buildSavedViewBody(overrides: CreateSavedViewInput = {}): CreateSavedViewBody {
	return {
		icon: "star",
		name: `Saved View ${crypto.randomUUID()}`,
		queryDocument: rowsDocument,
		displayConfiguration: defaultDisplayConfiguration,
		...overrides,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return {
		icon: "heart",
		name: `Updated View ${crypto.randomUUID()}`,
		isDisabled: false,
		queryDocument: rowsDocument,
		displayConfiguration: defaultDisplayConfiguration,
		...overrides,
	};
}

export function buildSavedViewQueryDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	return buildSavedViewBody({ ...overrides, queryDocument });
}

export function buildUpdatedSavedViewQueryDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return buildUpdatedSavedViewBody({ ...overrides, queryDocument });
}

export const createSavedView = (client: Client, overrides: CreateSavedViewInput = {}) =>
	client.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }));

export const createSavedViewWithQueryDocument = (
	client: Client,
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.create({
			payload: buildSavedViewQueryDocumentBody(queryDocument, overrides),
		}),
	);

export const listSavedViews = (
	client: Client,
	options: { pluginSlug?: string; includeDisabled?: boolean } = {},
) =>
	client.call((c) =>
		c.savedViews.list({
			query: {
				includeDisabled: options.includeDisabled ?? false,
				pluginSlug: options.pluginSlug ? PluginSlug.make(options.pluginSlug) : undefined,
			},
		}),
	);

export const findBuiltinSavedView = (client: Client) =>
	Effect.gen(function* () {
		const views = yield* listSavedViews(client);
		const builtinView = views.find((view) => view.isBuiltin);

		return requirePresent(builtinView, "Built-in saved view not found");
	});

export const getSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.get({ params: { viewSlug } }));

export const updateSavedView = (
	client: Client,
	viewSlug: string,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({
			params: { viewSlug },
			payload: buildUpdatedSavedViewBody(overrides),
		}),
	);

export const updateSavedViewWithQueryDocument = (
	client: Client,
	viewSlug: string,
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({
			params: { viewSlug },
			payload: buildUpdatedSavedViewQueryDocumentBody(queryDocument, overrides),
		}),
	);

export const cloneSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.clone({ params: { viewSlug } }));

export const deleteSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.delete({ params: { viewSlug } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
