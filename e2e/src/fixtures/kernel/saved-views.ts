import type { ContractPayload } from "@ryot-app/contract/client";
import { ascending, castJson, column, field, jsonPath, literal, table } from "@ryot-app/ryotql";
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
type SavedViewDataSources = CreateSavedViewBody["dataSources"];
type SavedViewSettings = CreateSavedViewBody["settings"];
type CreateSavedViewInput = Partial<CreateSavedViewBody>;
type UpdateSavedViewInput = Partial<UpdateSavedViewBody>;

class SavedViewFixtureError extends Data.TaggedError("SavedViewFixtureError")<{
	readonly message: string;
}> {}

const entity = table("entity", "entity");
const properties = column(entity, "properties");
const projections = buildSavedViewLayoutProjections({
	grid: {
		entity,
		card: {
			callout: null,
			secondaryMetadata: null,
			title: column(entity, "name"),
			image: castJson(jsonPath(properties, "images", 0)),
			overline: { displayKind: "text", expression: literal("Book") },
			primaryMetadata: { displayKind: "number", expression: jsonPath(properties, "publishYear") },
		},
	},
	list: {
		entity,
		card: {
			callout: null,
			secondaryMetadata: null,
			title: column(entity, "name"),
			image: castJson(jsonPath(properties, "images", 0)),
			overline: { displayKind: "text", expression: literal("Book list") },
			primaryMetadata: { displayKind: "number", expression: jsonPath(properties, "publishYear") },
		},
	},
	table: {
		entity,
		image: castJson(jsonPath(properties, "images", 0)),
		columns: [
			{ label: "Name", displayKind: "text", expression: column(entity, "name") },
			{ label: "Year", displayKind: "number", expression: jsonPath(properties, "publishYear") },
		],
	},
});

export const rowsFields = [
	...projections.table.fields,
	field("ownerPluginId", column(entity, "entitySchemaPluginId")),
	field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
];

export const buildSavedViewDataSources = (
	entitySchemaSlugs: readonly [string, ...string[]] = ["book"],
): NonNullable<SavedViewDataSources> =>
	savedViewRecipe({
		layout: { type: "table", mapping: projections.table.mappings },
		source: {
			limit: 2,
			type: "generated",
			entitySchemaSlugs,
			fields: rowsFields,
			orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
		},
	}).document;

export const rowsDataSources = buildSavedViewDataSources();

export const entityBrowserSettings = {
	pageSize: 2,
	addAction: null,
	sortChoices: [],
	defaultLayout: "grid",
	sourceName: "savedView",
	searchFields: ["column0"],
	entityIdField: "entityId",
	layouts: ["grid", "list", "table"],
	ownerPluginIdField: "ownerPluginId",
	entitySchemaSlugField: "entitySchemaSlug",
	tableColumns: projections.table.mappings.columns,
} satisfies SavedViewSettings;

export function buildSavedViewBody(overrides: CreateSavedViewInput = {}): CreateSavedViewBody {
	return {
		icon: "star",
		dataSources: rowsDataSources,
		settings: entityBrowserSettings,
		name: `Saved View ${crypto.randomUUID()}`,
		renderer: { kind: "kernel", name: "entity-browser" },
		...overrides,
	};
}

export function buildUpdatedSavedViewBody(
	overrides: UpdateSavedViewInput = {},
): UpdateSavedViewBody {
	return {
		icon: "heart",
		isDisabled: false,
		dataSources: rowsDataSources,
		settings: entityBrowserSettings,
		name: `Updated View ${crypto.randomUUID()}`,
		renderer: { kind: "kernel", name: "entity-browser" },
		...overrides,
	};
}

export const createSavedView = (client: Client, overrides: CreateSavedViewInput = {}) =>
	client.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }));

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
		return requirePresent(
			views.find((view) => view.isBuiltin),
			"Built-in saved view not found",
		);
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
		c.savedViews.update({ params: { viewSlug }, payload: buildUpdatedSavedViewBody(overrides) }),
	);

export const cloneSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.clone({ params: { viewSlug } }));

export const deleteSavedView = (client: Client, viewSlug: string) =>
	client.call((c) => c.savedViews.delete({ params: { viewSlug } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
