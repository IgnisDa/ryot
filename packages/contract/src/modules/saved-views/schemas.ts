import { Schema } from "effect";

import { PluginPackageId, SavedViewId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { AssetLocator } from "../assets/schemas";
import { ProviderLibraryMembership } from "../entity-providers/schemas";
import {
	AuthoredEntitySchemaReference,
	EntitySchemaReference,
	SavedViewReference,
} from "../plugins/references";
import { OutputFieldKey, RyotQLDocument } from "../ryotql/language";

const SavedViewBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("asset-forbidden") }),
	Schema.Struct({ code: Schema.Literal("duplicate-name") }),
	Schema.Struct({ code: Schema.Literal("renderer-not-found") }),
	Schema.Struct({ code: Schema.Literal("renderer-unpublished") }),
	Schema.Struct({ code: Schema.Literal("renderer-kind-unavailable") }),
	Schema.Struct({ installationId: Schema.String, code: Schema.Literal("plugin-not-found") }),
	Schema.Struct({ message: Schema.String, code: Schema.Literal("settings-incompatible") }),
	Schema.Struct({ reference: SavedViewReference, code: Schema.Literal("builtin-view-immutable") }),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["name", "slug"]),
	}),
	Schema.Struct({
		code: Schema.Literal("invalid-reorder"),
		references: Schema.Array(SavedViewReference),
		issue: Schema.Literals(["empty", "duplicate", "unknown-view", "update-failed"]),
	}),
]);

const SavedViewNotFoundReason = Schema.Union([
	Schema.Struct({ reference: SavedViewReference, code: Schema.Literal("saved-view-not-found") }),
]);

export class SavedViewBadRequest extends Schema.TaggedError<
	SavedViewBadRequest,
	{ readonly brand: unique symbol }
>()("SavedViewBadRequest", { reason: SavedViewBadRequestReason }) {}

export class SavedViewNotFound extends Schema.TaggedError<
	SavedViewNotFound,
	{ readonly brand: unique symbol }
>()("SavedViewNotFound", { reason: SavedViewNotFoundReason }) {}

export const SavedViewDisplayKind = Schema.Literals([
	"text",
	"date",
	"json",
	"number",
	"boolean",
	"managed-asset",
]);
export type SavedViewDisplayKind = typeof SavedViewDisplayKind.Type;

export const SavedViewDisplayValue = Schema.Union([
	strictStruct({ value: JsonValue, displayKind: Schema.Literal("json") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("text") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("date") }),
	strictStruct({ value: Schema.NullOr(Schema.Finite), displayKind: Schema.Literal("number") }),
	strictStruct({ value: Schema.NullOr(Schema.Boolean), displayKind: Schema.Literal("boolean") }),
	strictStruct({
		value: Schema.NullOr(AssetLocator),
		displayKind: Schema.Literal("managed-asset"),
	}),
]);
export type SavedViewDisplayValue = typeof SavedViewDisplayValue.Type;

export const SavedViewTableColumn = strictStruct({
	label: Schema.String,
	field: OutputFieldKey,
	displayKind: SavedViewDisplayKind,
});
export type SavedViewTableColumn = typeof SavedViewTableColumn.Type;

export const KernelSavedViewRendererName = Schema.Literals([
	"collection-browser",
	"entity-browser",
	"results-table",
]);
export type KernelSavedViewRendererName = typeof KernelSavedViewRendererName.Type;

export const AuthoredSavedViewRenderer = Schema.Union([
	strictStruct({ kind: Schema.Literal("kernel"), name: KernelSavedViewRendererName }),
	strictStruct({ exportName: Schema.String, kind: Schema.Literal("plugin") }),
]);
export type AuthoredSavedViewRenderer = typeof AuthoredSavedViewRenderer.Type;

export const SavedViewRenderer = Schema.Union([
	strictStruct({ kind: Schema.Literal("kernel"), name: KernelSavedViewRendererName }),
	strictStruct({
		pluginId: Schema.String,
		exportName: Schema.String,
		kind: Schema.Literal("plugin"),
	}),
]);
export type SavedViewRenderer = typeof SavedViewRenderer.Type;

export const EntityBrowserLayout = Schema.Literals(["grid", "list", "table"]);
export type EntityBrowserLayout = typeof EntityBrowserLayout.Type;

export const EntityBrowserSortChoice = strictStruct({
	label: Schema.String,
	name: Schema.NonEmptyString,
	orderBy: Schema.NonEmptyArray(
		strictStruct({ field: OutputFieldKey, direction: Schema.Literals(["asc", "desc"]) }),
	),
});
export type EntityBrowserSortChoice = typeof EntityBrowserSortChoice.Type;

const EntityBrowserProviderSearchAddAction = strictStruct({
	schema: EntitySchemaReference,
	library: ProviderLibraryMembership,
	type: Schema.Literal("provider-search"),
});

const AuthoredEntityBrowserProviderSearchAddAction = strictStruct({
	library: ProviderLibraryMembership,
	schema: AuthoredEntitySchemaReference,
	type: Schema.Literal("provider-search"),
});

export const EntityBrowserPluginRouteAddAction = strictStruct({
	packageId: PluginPackageId,
	type: Schema.Literal("plugin-route"),
	search: Schema.Record(Schema.String, Schema.String),
	path: Schema.NonEmptyString.pipe(
		Schema.check(
			Schema.makeFilter(
				(value) =>
					value.startsWith("/") &&
					!value.startsWith("//") &&
					!value.includes("?") &&
					!value.includes("#"),
			),
		),
	),
});

export const EntityBrowserAddAction = Schema.Union([
	EntityBrowserProviderSearchAddAction,
	EntityBrowserPluginRouteAddAction,
]);
export type EntityBrowserAddAction = typeof EntityBrowserAddAction.Type;

export const AuthoredEntityBrowserAddAction = Schema.Union([
	AuthoredEntityBrowserProviderSearchAddAction,
	EntityBrowserPluginRouteAddAction,
]);
export type AuthoredEntityBrowserAddAction = typeof AuthoredEntityBrowserAddAction.Type;

export const mapEntityBrowserAddActionSchema = <Schema, Mapped>(
	action:
		| typeof EntityBrowserPluginRouteAddAction.Type
		| {
				readonly schema: Schema;
				readonly type: "provider-search";
				readonly library: ProviderLibraryMembership;
		  }
		| null,
	mapSchema: (schema: Schema) => Mapped,
) =>
	action === null || action.type === "plugin-route"
		? action
		: { ...action, schema: mapSchema(action.schema) };

const SavedViewPageSize = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThan(0)),
	Schema.check(Schema.isLessThanOrEqualTo(100)),
);

export const EntityBrowserSavedViewSettings = strictStruct({
	pageSize: SavedViewPageSize,
	entityIdField: OutputFieldKey,
	sourceName: Schema.NonEmptyString,
	defaultLayout: EntityBrowserLayout,
	ownerPluginIdField: OutputFieldKey,
	entitySchemaSlugField: OutputFieldKey,
	searchFields: Schema.Array(OutputFieldKey),
	addAction: Schema.NullOr(EntityBrowserAddAction),
	layouts: Schema.NonEmptyArray(EntityBrowserLayout),
	sortChoices: Schema.Array(EntityBrowserSortChoice),
	tableColumns: Schema.NullOr(Schema.NonEmptyArray(SavedViewTableColumn)),
});
export type EntityBrowserSavedViewSettings = typeof EntityBrowserSavedViewSettings.Type;

export const AuthoredEntityBrowserSavedViewSettings = strictStruct({
	...EntityBrowserSavedViewSettings.fields,
	addAction: Schema.NullOr(AuthoredEntityBrowserAddAction),
});
export type AuthoredEntityBrowserSavedViewSettings =
	typeof AuthoredEntityBrowserSavedViewSettings.Type;

export const ResultsTableSavedViewSettings = strictStruct({
	pageSize: SavedViewPageSize,
	sourceName: Schema.NonEmptyString,
	rowKeyFields: Schema.NonEmptyArray(OutputFieldKey),
	columns: Schema.NonEmptyArray(SavedViewTableColumn),
	entityLink: Schema.NullOr(strictStruct({ entityIdField: OutputFieldKey })),
});
export type ResultsTableSavedViewSettings = typeof ResultsTableSavedViewSettings.Type;

const ListedSavedViewBase = {
	id: SavedViewId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Finite,
	isHidden: Schema.Boolean,
	reference: SavedViewReference,
	pluginInstallationId: Schema.NullOr(Schema.String),
};

const ListedSavedViewFields = {
	...ListedSavedViewBase,
	renderer: SavedViewRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
};

export const ListedSavedView = Schema.Union([
	strictStruct({
		...ListedSavedViewFields,
		createdAt: Schema.String,
		updatedAt: Schema.String,
		isBuiltin: Schema.Literal(false),
	}),
	strictStruct({
		...ListedSavedViewFields,
		createdAt: Schema.Null,
		updatedAt: Schema.Null,
		isBuiltin: Schema.Literal(true),
	}),
]);

export type ListedSavedView = typeof ListedSavedView.Type;

export const SavedViewCommandResponse = strictStruct({ id: SavedViewId });

export const CreateSavedViewBody = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	renderer: SavedViewRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	workspaceInstallationId: Schema.optional(Schema.String),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = strictStruct({
	isHidden: Schema.Boolean,
	icon: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	renderer: Schema.optional(SavedViewRenderer),
	dataSources: Schema.optional(Schema.NullOr(RyotQLDocument)),
	settings: Schema.optional(Schema.Record(Schema.String, JsonValue)),
	workspaceInstallationId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	references: Schema.Array(SavedViewReference),
	installationId: Schema.optional(Schema.String),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	references: Schema.Array(SavedViewReference),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
