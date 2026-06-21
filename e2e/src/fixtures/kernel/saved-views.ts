import type { ContractPayload } from "@ryot-app/contract/client";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { castJson, column, jsonPath, literal, table } from "@ryot-app/ryotql";
import {
	savedViewRecordRecipe,
	savedViewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/saved-view-records";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";
import { Data, Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

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
		entityId: column(entity, "id"),
		card: {
			callout: null,
			secondaryMetadata: null,
			overline: { displayKind: "text", expression: literal("Book") },
			title: column(entity, "name"),
			primaryMetadata: { displayKind: "number", expression: entityProperty("publishYear") },
			image: castJson(entityProperty("images", 0)),
		},
	},
	list: {
		entityId: column(entity, "id"),
		card: {
			callout: null,
			secondaryMetadata: null,
			overline: { displayKind: "text", expression: literal("Book list") },
			title: column(entity, "name"),
			primaryMetadata: { displayKind: "number", expression: entityProperty("publishYear") },
			image: castJson(entityProperty("images", 0)),
		},
	},
	table: {
		entityId: column(entity, "id"),
		image: castJson(entityProperty("images", 0)),
		columns: [
			{ label: "Name", displayKind: "text", expression: column(entity, "name") },
			{ label: "Year", displayKind: "number", expression: entityProperty("publishYear") },
		],
	},
});

const cardLayoutDocument = (
	projection: typeof defaultProjections.grid,
	entitySchemaSlugs: readonly [string, ...string[]],
) =>
	savedViewRecipe({
		layout: { type: "card", mapping: projection.mappings },
		source: { type: "generated", limit: 2, entitySchemaSlugs, fields: projection.fields },
	}).document;

const tableLayoutDocument = (
	projection: typeof defaultProjections.table,
	entitySchemaSlugs: readonly [string, ...string[]],
) =>
	savedViewRecipe({
		layout: { type: "table", mapping: projection.mappings },
		source: { type: "generated", limit: 2, entitySchemaSlugs, fields: projection.fields },
	}).document;

export function buildSavedViewLayouts(
	documents: Partial<Record<keyof SavedViewLayouts, SavedViewQueryDocument>> = {},
	entitySchemaSlugs: readonly [string, ...string[]] = ["book"],
): SavedViewLayouts {
	return {
		grid: {
			...defaultProjections.grid.mappings,
			queryDocument:
				documents.grid ?? cardLayoutDocument(defaultProjections.grid, entitySchemaSlugs),
		},
		list: {
			...defaultProjections.list.mappings,
			queryDocument:
				documents.list ?? cardLayoutDocument(defaultProjections.list, entitySchemaSlugs),
		},
		table: {
			...defaultProjections.table.mappings,
			queryDocument:
				documents.table ?? tableLayoutDocument(defaultProjections.table, entitySchemaSlugs),
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
		entitySchemaSlug: EntitySchemaSlug.make("book"),
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
		entitySchemaSlug: EntitySchemaSlug.make("book"),
		...overrides,
	};
}

export function savedViewGridDocumentBody(
	queryDocument: SavedViewQueryDocument,
	overrides: CreateSavedViewInput = {},
): CreateSavedViewBody {
	return buildSavedViewBody({
		layouts: buildSavedViewLayouts({ grid: queryDocument }),
		...overrides,
	});
}

export function updatedSavedViewGridDocumentBody(
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
		c.savedViews.create({ payload: savedViewGridDocumentBody(queryDocument, overrides) }),
	);

export const listSavedViews = (
	client: Client,
	options: { pluginSlug?: string; includeDisabled?: boolean } = {},
) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			savedViewRecordsRecipe({
				limit: 100,
				pluginSlug: options.pluginSlug,
				includeDisabled: options.includeDisabled,
			}),
		);
		return result.items;
	});

export const findBuiltinSavedView = (client: Client) =>
	Effect.gen(function* () {
		const views = yield* listSavedViews(client);
		const builtinView = views.find((view) => view.isBuiltin);

		return requirePresent(builtinView, "Built-in saved view not found");
	});

export const getSavedView = (client: Client, viewSlug: string) =>
	Effect.gen(function* () {
		const decoded = yield* executeRyotQLRecipe(client, savedViewRecordRecipe({ slug: viewSlug }));
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
			payload: updatedSavedViewGridDocumentBody(queryDocument, overrides),
		}),
	);

export const cloneSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.clone({ params: { viewSlug } }));

export const deleteSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.delete({ params: { viewSlug } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
