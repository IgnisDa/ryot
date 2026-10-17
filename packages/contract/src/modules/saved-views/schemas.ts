import { Schema } from "effect";

import { PluginPackageId, SavedViewId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { AssetLocator } from "../assets/schemas";
import { ProviderLibraryMembership } from "../entity-providers/schemas";
import { AuthoredFilterField, FilterField } from "../filters/schemas";
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
		issue: Schema.Literals(["empty", "duplicate", "unknown-view"]),
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
	"year",
	"boolean",
	"managed-asset",
]);
export type SavedViewDisplayKind = typeof SavedViewDisplayKind.Type;

export const SavedViewDisplayValue = Schema.Union([
	strictStruct({ value: JsonValue, displayKind: Schema.Literal("json") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("text") }),
	strictStruct({ value: Schema.NullOr(Schema.String), displayKind: Schema.Literal("date") }),
	strictStruct({ value: Schema.NullOr(Schema.Finite), displayKind: Schema.Literal("number") }),
	strictStruct({ value: Schema.NullOr(Schema.Finite), displayKind: Schema.Literal("year") }),
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
	"calendar",
	"collection-browser",
	"entity-browser",
	"results-table",
]);
export type KernelSavedViewRendererName = typeof KernelSavedViewRendererName.Type;

export const CALENDAR_KERNEL_RENDERER_DISPLAY_NAME = "Calendar";

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

export const SavedViewSubject = strictStruct({
	entityAlias: Schema.NonEmptyString,
	schemas: Schema.NonEmptyArray(EntitySchemaReference),
});
export type SavedViewSubject = typeof SavedViewSubject.Type;

export const AuthoredSavedViewSubject = strictStruct({
	entityAlias: Schema.NonEmptyString,
	schemas: Schema.NonEmptyArray(AuthoredEntitySchemaReference),
});
export type AuthoredSavedViewSubject = typeof AuthoredSavedViewSubject.Type;

export const EntityBrowserSavedViewSettings = strictStruct({
	subject: SavedViewSubject,
	pageSize: SavedViewPageSize,
	sourceName: Schema.NonEmptyString,
	defaultLayout: EntityBrowserLayout,
	searchFields: Schema.Array(OutputFieldKey),
	addAction: Schema.NullOr(EntityBrowserAddAction),
	layouts: Schema.NonEmptyArray(EntityBrowserLayout),
	sortChoices: Schema.Array(EntityBrowserSortChoice),
	filterFields: Schema.optionalKey(Schema.Array(FilterField)),
	tableColumns: Schema.NullOr(Schema.NonEmptyArray(SavedViewTableColumn)),
});
export type EntityBrowserSavedViewSettings = typeof EntityBrowserSavedViewSettings.Type;

export const AuthoredEntityBrowserSavedViewSettings = strictStruct({
	...EntityBrowserSavedViewSettings.fields,
	subject: AuthoredSavedViewSubject,
	addAction: Schema.NullOr(AuthoredEntityBrowserAddAction),
	filterFields: Schema.optionalKey(Schema.Array(AuthoredFilterField)),
});
export type AuthoredEntityBrowserSavedViewSettings =
	typeof AuthoredEntityBrowserSavedViewSettings.Type;

export const ResultsTableSavedViewSettings = strictStruct({
	pageSize: SavedViewPageSize,
	sourceName: Schema.NonEmptyString,
	rowKeyFields: Schema.NonEmptyArray(OutputFieldKey),
	columns: Schema.NonEmptyArray(SavedViewTableColumn),
	filterFields: Schema.optionalKey(Schema.Array(FilterField)),
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

const EntityBrowserKernelRenderer = strictStruct({
	kind: Schema.Literal("kernel"),
	name: Schema.Literals(["collection-browser", "entity-browser"]),
});

const ResultsTableKernelRenderer = strictStruct({
	kind: Schema.Literal("kernel"),
	name: Schema.Literal("results-table"),
});

const PluginSavedViewRenderer = strictStruct({
	pluginId: Schema.String,
	exportName: Schema.String,
	kind: Schema.Literal("plugin"),
});

const AuthoredPluginSavedViewRenderer = strictStruct({
	exportName: Schema.String,
	kind: Schema.Literal("plugin"),
});

const AuthoredQueryDocument = Schema.toType(RyotQLDocument);

const savedViewConfigFields = [
	{
		dataSources: RyotQLDocument,
		renderer: EntityBrowserKernelRenderer,
		settings: EntityBrowserSavedViewSettings,
	},
	{
		dataSources: RyotQLDocument,
		renderer: ResultsTableKernelRenderer,
		settings: ResultsTableSavedViewSettings,
	},
	{
		renderer: PluginSavedViewRenderer,
		dataSources: Schema.NullOr(RyotQLDocument),
		settings: Schema.Record(Schema.String, JsonValue),
	},
] as const;

const authoredSavedViewConfigFields = [
	{
		dataSources: AuthoredQueryDocument,
		renderer: EntityBrowserKernelRenderer,
		settings: AuthoredEntityBrowserSavedViewSettings,
	},
	{
		dataSources: AuthoredQueryDocument,
		renderer: ResultsTableKernelRenderer,
		settings: ResultsTableSavedViewSettings,
	},
	{
		renderer: AuthoredPluginSavedViewRenderer,
		dataSources: Schema.NullOr(AuthoredQueryDocument),
		settings: Schema.Record(Schema.String, JsonValue),
	},
] as const;

const withSavedViewConfig = <
	Common extends Schema.Struct.Fields,
	Entity extends Schema.Struct.Fields,
	Table extends Schema.Struct.Fields,
	Plugin extends Schema.Struct.Fields,
>(
	common: Common,
	[entity, table, plugin]: readonly [Entity, Table, Plugin],
) =>
	Schema.Union([
		strictStruct({ ...common, ...entity }),
		strictStruct({ ...common, ...table }),
		strictStruct({ ...common, ...plugin }),
	]);

export const SavedViewRendererConfig = withSavedViewConfig({}, savedViewConfigFields);
export type SavedViewRendererConfig = typeof SavedViewRendererConfig.Type;

export const AuthoredSavedViewRendererConfig = withSavedViewConfig(
	{},
	authoredSavedViewConfigFields,
);
export type AuthoredSavedViewRendererConfig = typeof AuthoredSavedViewRendererConfig.Type;

export const withAuthoredSavedViewConfig = <Common extends Schema.Struct.Fields>(common: Common) =>
	withSavedViewConfig(common, authoredSavedViewConfigFields);

const createCommon = {
	icon: Schema.String,
	name: Schema.String,
	workspaceInstallationId: Schema.optional(Schema.String),
};

export const CreateSavedViewBody = withSavedViewConfig(createCommon, savedViewConfigFields);

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

const updateCommon = {
	isHidden: Schema.Boolean,
	icon: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	workspaceInstallationId: Schema.optional(Schema.NullOr(Schema.String)),
};

export const updateSavedViewBody = <Common extends Schema.Struct.Fields>(common: Common) =>
	Schema.Union([
		strictStruct({ ...common, ...updateCommon }),
		withSavedViewConfig({ ...common, ...updateCommon }, savedViewConfigFields),
	]);

export const UpdateSavedViewBody = updateSavedViewBody({});

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
