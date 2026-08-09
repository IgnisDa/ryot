import { Schema } from "effect";

import { EntitySchemaSlug, PluginSlug, SavedViewId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { JsonValue, OutputFieldKey, RyotQLDocument } from "../ryotql/language";
import { AssetLocator } from "../uploads/schemas";

const SavedViewBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("duplicate-name") }),
	Schema.Struct({ code: Schema.Literal("renderer-not-found") }),
	Schema.Struct({ code: Schema.Literal("renderer-unpublished") }),
	Schema.Struct({ code: Schema.Literal("renderer-kind-unavailable") }),
	Schema.Struct({ pluginSlug: PluginSlug, code: Schema.Literal("plugin-not-found") }),
	Schema.Struct({ message: Schema.String, code: Schema.Literal("settings-incompatible") }),
	Schema.Struct({ viewSlug: Schema.String, code: Schema.Literal("builtin-view-immutable") }),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["name", "slug"]),
	}),
	Schema.Struct({
		viewSlugs: Schema.Array(Schema.String),
		code: Schema.Literal("invalid-reorder"),
		issue: Schema.Literals(["empty", "duplicate", "unknown-view", "update-failed"]),
	}),
]);

const SavedViewNotFoundReason = Schema.Union([
	Schema.Struct({ viewSlug: Schema.String, code: Schema.Literal("saved-view-not-found") }),
]);

export class SavedViewBadRequest extends Schema.TaggedError<SavedViewBadRequest>()(
	"SavedViewBadRequest",
	{ reason: SavedViewBadRequestReason },
) {}

export class SavedViewNotFound extends Schema.TaggedError<SavedViewNotFound>()(
	"SavedViewNotFound",
	{ reason: SavedViewNotFoundReason },
) {}

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
	strictStruct({ value: Schema.NullOr(Schema.Number), displayKind: Schema.Literal("number") }),
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

export const KernelSavedViewRendererName = Schema.Literals(["entity-browser", "results-table"]);
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

export const EntityBrowserAddAction = strictStruct({
	entitySchemaSlug: EntitySchemaSlug,
	ownerPluginId: Schema.NonEmptyString,
	type: Schema.Literal("provider-search"),
});
export type EntityBrowserAddAction = typeof EntityBrowserAddAction.Type;

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
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	pluginSlug: Schema.NullOr(PluginSlug),
};

export const ListedSavedView = strictStruct({
	...ListedSavedViewBase,
	renderer: SavedViewRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const SavedViewCommandResponse = strictStruct({ id: SavedViewId });

export const CreateSavedViewBody = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	renderer: SavedViewRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	workspacePluginSlug: Schema.optional(PluginSlug),
	settings: Schema.Record(Schema.String, JsonValue),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = strictStruct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	renderer: Schema.optional(SavedViewRenderer),
	dataSources: Schema.optional(Schema.NullOr(RyotQLDocument)),
	workspacePluginSlug: Schema.optional(Schema.NullOr(PluginSlug)),
	settings: Schema.optional(Schema.Record(Schema.String, JsonValue)),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	pluginSlug: Schema.optional(PluginSlug),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({ viewSlugs: Schema.Array(Schema.String) });

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
