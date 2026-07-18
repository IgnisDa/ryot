import type { ContractPayload } from "@ryot/contract/client";
import { castJson, column, jsonPath, literal, table } from "@ryot/ryotql";
import {
	buildSavedViewRecordDocument,
	buildSavedViewRecordsDocument,
	decodeSavedViewRecordResponse,
	decodeSavedViewRecordsResponse,
} from "@ryot/ryotql-recipes/saved-view-records";
import {
	buildSavedViewDocument,
	buildSavedViewLayoutProjections,
} from "@ryot/ryotql-recipes/saved-views";
import { Data, Effect } from "effect";

import { requirePresent, resultToEffect } from "~/support/assertions";

import type { Client } from "./auth";

type CreateSavedViewBody = ContractPayload<"savedViews", "create">;
type UpdateSavedViewBody = ContractPayload<"savedViews", "update">;
type ReorderSavedViewsBody = ContractPayload<"savedViews", "reorder">;

export type SavedViewLayouts = CreateSavedViewBody["layouts"];
export type SavedViewQueryDocument = SavedViewLayouts["grid"]["queryDocument"];
type CreateSavedViewInput = Partial<CreateSavedViewBody>;
type UpdateSavedViewInput = Partial<UpdateSavedViewBody>;

class SavedViewFixtureError extends Data.TaggedError("SavedViewFixtureError")<{
	readonly message: string;
}> {}

const entity = table("entity", "entity");
const entityProperties = column(entity, "properties");
const entityProperty = (...path: [string | number, ...(string | number)[]]) =>
	jsonPath(entityProperties, ...path);

const defaultProjections = buildSavedViewLayoutProjections({
	grid: {
		itemId: column(entity, "id"),
		card: {
			callout: null,
			secondaryMetadata: null,
			overline: literal("Book"),
			title: column(entity, "name"),
			primaryMetadata: entityProperty("publishYear"),
			image: castJson(entityProperty("images", 0)),
		},
	},
	list: {
		itemId: column(entity, "id"),
		card: {
			callout: null,
			secondaryMetadata: null,
			overline: literal("Book list"),
			title: column(entity, "name"),
			primaryMetadata: entityProperty("publishYear"),
			image: castJson(entityProperty("images", 0)),
		},
	},
	table: {
		itemId: column(entity, "id"),
		image: castJson(entityProperty("images", 0)),
		columns: [
			{ label: "Name", expression: column(entity, "name") },
			{ label: "Year", expression: entityProperty("publishYear") },
		],
	},
});

const layoutDocument = (
	fields: readonly (typeof defaultProjections.grid.fields)[number][],
	entitySchemaSlugs: readonly [string, ...string[]],
) => buildSavedViewDocument({ page: 1, limit: 2, entitySchemaSlugs, fields });

export function buildSavedViewLayouts(
	documents: Partial<Record<keyof SavedViewLayouts, SavedViewQueryDocument>> = {},
	entitySchemaSlugs: readonly [string, ...string[]] = ["book"],
): SavedViewLayouts {
	return {
		grid: {
			...defaultProjections.grid.mappings,
			queryDocument:
				documents.grid ?? layoutDocument(defaultProjections.grid.fields, entitySchemaSlugs),
		},
		list: {
			...defaultProjections.list.mappings,
			queryDocument:
				documents.list ?? layoutDocument(defaultProjections.list.fields, entitySchemaSlugs),
		},
		table: {
			...defaultProjections.table.mappings,
			queryDocument:
				documents.table ?? layoutDocument(defaultProjections.table.fields, entitySchemaSlugs),
		},
	};
}

export const rowsLayouts = buildSavedViewLayouts();
export const rowsDocument = rowsLayouts.grid.queryDocument;

const rowsQuery = rowsDocument.queries.savedView;
if (rowsQuery?.output.type !== "rows") {
	throw new Error("Saved view fixture requires a savedView rows query");
}
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
		layouts: rowsLayouts,
		name: `Saved View ${crypto.randomUUID()}`,
		...overrides,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return {
		icon: "heart",
		isDisabled: false,
		layouts: rowsLayouts,
		name: `Updated View ${crypto.randomUUID()}`,
		...overrides,
	};
}

export function buildSavedViewGridDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	return buildSavedViewBody({
		layouts: buildSavedViewLayouts({ grid: queryDocument }),
		...overrides,
	});
}

export function buildUpdatedSavedViewGridDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return buildUpdatedSavedViewBody({
		layouts: buildSavedViewLayouts({ grid: queryDocument }),
		...overrides,
	});
}

export const createSavedView = (client: Client, overrides: CreateSavedViewInput = {}) =>
	client.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }));

export const createSavedViewWithGridDocument = (
	client: Client,
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.create({ payload: buildSavedViewGridDocumentBody(queryDocument, overrides) }),
	);

export const listSavedViews = (
	client: Client,
	options: { pluginSlug?: string; includeDisabled?: boolean } = {},
) =>
	Effect.gen(function* () {
		const response = yield* client.call((c) =>
			c.ryotql.execute({
				payload: buildSavedViewRecordsDocument({
					page: 1,
					limit: 100,
					pluginSlug: options.pluginSlug,
					includeDisabled: options.includeDisabled,
				}),
			}),
		);
		const decoded = yield* resultToEffect(decodeSavedViewRecordsResponse(response));

		return decoded.items;
	});

export const findBuiltinSavedView = (client: Client) =>
	Effect.gen(function* () {
		const views = yield* listSavedViews(client);
		const builtinView = views.find((view) => view.isBuiltin);

		return requirePresent(builtinView, "Built-in saved view not found");
	});

export const getSavedView = (client: Client, viewSlug: string) =>
	Effect.gen(function* () {
		const response = yield* client.call((c) =>
			c.ryotql.execute({ payload: buildSavedViewRecordDocument({ slug: viewSlug }) }),
		);
		const decoded = yield* resultToEffect(decodeSavedViewRecordResponse(response));
		if (!decoded) {
			return yield* new SavedViewFixtureError({ message: `Saved view '${viewSlug}' not found` });
		}

		return decoded;
	});

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

export const updateSavedViewWithGridDocument = (
	client: Client,
	viewSlug: string,
	queryDocument: SavedViewQueryDocument,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({
			params: { viewSlug },
			payload: buildUpdatedSavedViewGridDocumentBody(queryDocument, overrides),
		}),
	);

export const cloneSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.clone({ params: { viewSlug } }));

export const deleteSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.delete({ params: { viewSlug } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
