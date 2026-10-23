import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import type {
	PluginIdentityReference,
	QueryOwnerReference,
	SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type {
	AuthoredEntityBrowserSavedViewSettings,
	EntityBrowserSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	type PluginId,
	type PluginPackageId,
} from "@ryot-app/contract/schema/brands";
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
import { findPluginInstallationByPackage } from "./plugins";
import { executeRyotQLRecipe } from "./ryotql";

type ReorderSavedViewsBody = ContractPayload<"savedViews", "reorder">;

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
): RyotQLDocument =>
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

const entityBrowserSettingsBase = {
	pageSize: 2,
	addAction: null,
	sortChoices: [],
	defaultLayout: "grid",
	searchFields: ["name"],
	sourceName: "savedView",
	layouts: ["grid", "list", "table"],
	tableColumns: [
		{ label: "Name", field: "name", displayKind: "text" },
		{ label: "Year", field: "year", displayKind: "number" },
	],
} satisfies Omit<EntityBrowserSavedViewSettings, "subject">;

export const entityBrowserSettings = (pluginId: PluginId, schemaSlug = "book") =>
	({
		...entityBrowserSettingsBase,
		subject: {
			entityAlias: "entity",
			schemas: [
				{ slug: EntitySchemaSlug.make(schemaSlug), owner: { pluginId, kind: "plugin" as const } },
			],
		},
	}) satisfies EntityBrowserSavedViewSettings;

export const authoredEntityBrowserSettings = {
	...entityBrowserSettingsBase,
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("book") }],
	},
} satisfies AuthoredEntityBrowserSavedViewSettings;

type CreatePayload = ContractPayload<"savedViews", "create">;
type UpdatePayload = Omit<ContractPayload<"savedViews", "update">, "reference">;
type EntityBrowserCreatePayload = Extract<
	CreatePayload,
	{ renderer: { name: "collection-browser" | "entity-browser" } }
>;
type ResultsTableCreatePayload = Extract<CreatePayload, { renderer: { name: "results-table" } }>;
type EntityBrowserUpdatePayload = UpdatePayload &
	Pick<EntityBrowserCreatePayload, "dataSources" | "renderer" | "settings">;

type CommonOverrides = { icon?: string; name?: string; workspaceInstallationId?: string };
type ConfigOverrides = { dataSources?: RyotQLDocument; settings?: EntityBrowserSavedViewSettings };
type UpdateOverrides = Partial<{ isHidden: boolean; workspaceInstallationId: string | null }> &
	Omit<CommonOverrides, "workspaceInstallationId"> &
	ConfigOverrides;

const entityBrowserRenderer = { kind: "kernel", name: "entity-browser" } as const;

const withWorkspace = (workspaceInstallationId: string | undefined) =>
	workspaceInstallationId === undefined ? {} : { workspaceInstallationId };

export function buildSavedViewBody(
	pluginId: PluginId,
	overrides: CommonOverrides & ConfigOverrides = {},
): EntityBrowserCreatePayload {
	return {
		icon: overrides.icon ?? "star",
		renderer: entityBrowserRenderer,
		dataSources: overrides.dataSources ?? rowsDataSources,
		name: overrides.name ?? `Saved View ${crypto.randomUUID()}`,
		settings: overrides.settings ?? entityBrowserSettings(pluginId),
		...withWorkspace(overrides.workspaceInstallationId),
	};
}

export function buildUpdatedSavedViewBody(
	pluginId: PluginId,
	overrides: UpdateOverrides = {},
): EntityBrowserUpdatePayload {
	return {
		icon: overrides.icon ?? "heart",
		renderer: entityBrowserRenderer,
		isHidden: overrides.isHidden ?? false,
		dataSources: overrides.dataSources ?? rowsDataSources,
		name: overrides.name ?? `Updated View ${crypto.randomUUID()}`,
		settings: overrides.settings ?? entityBrowserSettings(pluginId),
		...(overrides.workspaceInstallationId === undefined
			? {}
			: { workspaceInstallationId: overrides.workspaceInstallationId }),
	};
}

const mediaPluginId = (client: Client) =>
	findPluginInstallationByPackage(client, {
		scope: "system",
		packageId: mediaPlugin.metadata.packageId,
	}).pipe(Effect.map(({ pluginId }) => pluginId));

const customViewResult = (result: {
	readonly id: ContractSuccess<"savedViews", "create">["id"];
}) => ({ ...result, reference: { savedViewId: result.id, kind: "custom" as const } });

export const createSavedView = (
	client: Client,
	overrides: CommonOverrides & ConfigOverrides = {},
) =>
	Effect.gen(function* () {
		const pluginId = yield* mediaPluginId(client);
		return customViewResult(
			yield* client.call((c) =>
				c.savedViews.create({ payload: buildSavedViewBody(pluginId, overrides) }),
			),
		);
	});

export const createTableSavedView = (
	client: Client,
	input: Omit<ResultsTableCreatePayload, "renderer" | "icon"> & { readonly icon?: string },
) =>
	client
		.call((c) =>
			c.savedViews.create({
				payload: {
					...input,
					icon: input.icon ?? "star",
					renderer: { kind: "kernel", name: "results-table" },
				},
			}),
		)
		.pipe(Effect.map(customViewResult));

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
	overrides: UpdateOverrides = {},
) =>
	Effect.gen(function* () {
		const pluginId = yield* mediaPluginId(client);
		return yield* client.call((c) =>
			c.savedViews.update({
				payload: { ...buildUpdatedSavedViewBody(pluginId, overrides), reference },
			}),
		);
	});

export const updateSavedViewMetadata = (
	client: Client,
	reference: SavedViewReference,
	input: Omit<UpdatePayload, "isHidden"> & { readonly isHidden?: boolean },
) =>
	client.call((c) =>
		c.savedViews.update({ payload: { ...input, reference, isHidden: input.isHidden ?? false } }),
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
