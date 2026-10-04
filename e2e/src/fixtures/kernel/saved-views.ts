import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import type {
	PluginIdentityReference,
	QueryOwnerReference,
	SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import {
	and,
	ascending,
	castJson,
	column,
	defineRecipe,
	document,
	field,
	inArray,
	jsonPath,
	literal,
	rows,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import {
	savedViewRecordRecipe,
	savedViewRecordsRecipe,
} from "@ryot-app/ryotql-recipes/saved-view-records";
import { Data, Effect, Result, Schema } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

type CreateSavedViewBody = ContractPayload<"savedViews", "create">;
type UpdateSavedViewBody = Omit<ContractPayload<"savedViews", "update">, "reference">;
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
export const rowsFields = [
	field("entityId", column(entity, "id")),
	field("image", castJson(jsonPath(properties, "images", 0))),
	field("name", column(entity, "name")),
	field("year", jsonPath(properties, "publishYear")),
	field("ownerPluginId", column(entity, "entitySchemaPluginId")),
	field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
];

export const buildSavedViewDataSources = (
	entitySchemaSlugs: readonly [string, ...string[]],
	owner: QueryOwnerReference,
): NonNullable<SavedViewDataSources> =>
	document({
		savedView: rows(entity, {
			limit: 2,
			fields: rowsFields,
			orderBy: [ascending(column(entity, "name")), ascending(column(entity, "id"))],
			where: and(
				inArray(
					column(entity, "entitySchemaSlug"),
					entitySchemaSlugs.map((slug) => literal(slug)),
				),
				schemaOwnerPredicate(entity, "entitySchemaPluginId", owner),
			),
		}),
	});

const mediaPluginOwner: PluginIdentityReference = {
	kind: "package",
	scope: "system",
	packageId: mediaPlugin.metadata.packageId,
};

export const rowsDataSources = buildSavedViewDataSources(["book"], mediaPluginOwner);

export const entityBrowserSettings = {
	pageSize: 2,
	addAction: null,
	sortChoices: [],
	defaultLayout: "grid",
	searchFields: ["name"],
	sourceName: "savedView",
	entityIdField: "entityId",
	layouts: ["grid", "list", "table"],
	ownerPluginIdField: "ownerPluginId",
	entitySchemaSlugField: "entitySchemaSlug",
	tableColumns: [
		{ label: "Name", field: "name", displayKind: "text" },
		{ label: "Year", field: "year", displayKind: "number" },
	],
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
		isHidden: false,
		dataSources: rowsDataSources,
		settings: entityBrowserSettings,
		name: `Updated View ${crypto.randomUUID()}`,
		renderer: { kind: "kernel", name: "entity-browser" },
		...overrides,
	};
}

export const createSavedView = (client: Client, overrides: CreateSavedViewInput = {}) =>
	client
		.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) }))
		.pipe(
			Effect.map((created) => ({
				...created,
				reference: { kind: "custom" as const, savedViewId: created.id },
			})),
		);

const workspaceView = table("savedView", "workspaceView");
export const workspaceSavedViewRecordsRecipe = defineRecipe(() => ({
	map: ({ views }) => Result.succeed(views.items),
	queries: {
		views: selectedRows(workspaceView, {
			limit: 100,
			orderBy: [ascending(column(workspaceView, "id"))],
			selection: {
				id: selectedField(column(workspaceView, "id"), Schema.String),
				installationId: selectedField(
					column(workspaceView, "pluginInstallationId"),
					Schema.NullOr(Schema.String),
				),
			},
		}),
	},
}));

export const listSavedViews = (
	client: Client,
	options: { pluginId?: PluginId; installationId?: string; includeHidden?: boolean } = {},
) =>
	Effect.gen(function* () {
		const result = yield* executeRyotQLRecipe(
			client,
			savedViewRecordsRecipe({
				limit: 100,
				pluginId: options.pluginId,
				includeHidden: options.includeHidden,
			}),
		);
		if (!options.installationId) {
			return result.items;
		}
		const associations = yield* executeRyotQLRecipe(client, workspaceSavedViewRecordsRecipe());
		return result.items.filter((view) =>
			associations.some(
				(association) =>
					association.id === view.id && association.installationId === options.installationId,
			),
		);
	});

export const findSavedViewById = (
	client: Client,
	id: ContractSuccess<"savedViews", "create">["id"],
) =>
	Effect.gen(function* () {
		const views = yield* listSavedViews(client, { includeHidden: true });
		return requirePresent(
			views.find((view) => view.id === id),
			`Saved view '${id}' not found`,
		);
	});

export const savedViewRecordPath = (view: {
	readonly reference: SavedViewReference;
	readonly packageId: PluginPackageId | null;
}) =>
	view.reference.kind === "plugin"
		? savedViewPath({
				kind: "plugin",
				slug: view.reference.slug,
				packageId: requirePresent(view.packageId, "Plugin saved view has no package identity"),
			})
		: savedViewPath(view.reference);

type BuiltinSavedViewReference = Exclude<SavedViewReference, { kind: "custom" }>;

export const findBuiltinSavedView = (client: Client, reference: BuiltinSavedViewReference) =>
	Effect.gen(function* () {
		const view = yield* getSavedView(client, reference);
		return requirePresent(view.isBuiltin ? view : undefined, "Built-in saved view not found");
	});

export const getSavedView = (client: Client, reference: SavedViewReference) =>
	Effect.gen(function* () {
		const decoded = yield* executeRyotQLRecipe(client, savedViewRecordRecipe(reference));
		if (!decoded) {
			return yield* new SavedViewFixtureError({ message: "Saved view not found" });
		}
		return decoded;
	});

export const updateSavedView = (
	client: Client,
	reference: SavedViewReference,
	overrides: UpdateSavedViewInput = {},
) =>
	client.call((c) =>
		c.savedViews.update({ payload: { ...buildUpdatedSavedViewBody(overrides), reference } }),
	);

export const cloneSavedView = (client: Client, reference: SavedViewReference) =>
	client
		.call((c) => c.savedViews.clone({ payload: { reference } }))
		.pipe(
			Effect.map((created) =>
				Object.assign({}, created, {
					reference: { kind: "custom" as const, savedViewId: created.id },
				}),
			),
		);

export const deleteSavedView = (client: Client, reference: SavedViewReference) =>
	client.call((c) => c.savedViews.delete({ payload: { reference } }));

export const reorderSavedViews = (client: Client, body: ReorderSavedViewsBody) =>
	client.call((c) => c.savedViews.reorder({ payload: body }));
