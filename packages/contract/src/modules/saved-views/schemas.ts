import { Schema } from "effect";

import { PluginSlug, SavedViewId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { OutputFieldKey, RyotQLDocument } from "../ryotql/language";

export const SavedViewCardMapping = strictStruct({
	titleField: OutputFieldKey,
	imageField: Schema.NullOr(OutputFieldKey),
	calloutField: Schema.NullOr(OutputFieldKey),
	overlineField: Schema.NullOr(OutputFieldKey),
	primaryMetadataField: Schema.NullOr(OutputFieldKey),
	secondaryMetadataField: Schema.NullOr(OutputFieldKey),
});
export type SavedViewCardMapping = typeof SavedViewCardMapping.Type;

export const SavedViewTableMapping = strictStruct({
	imageField: Schema.NullOr(OutputFieldKey),
	columns: Schema.NonEmptyArray(strictStruct({ label: Schema.String, field: OutputFieldKey })),
});
export type SavedViewTableMapping = typeof SavedViewTableMapping.Type;

const SavedViewCardLayout = strictStruct({
	...SavedViewCardMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: RyotQLDocument,
});

const SavedViewTableLayout = strictStruct({
	...SavedViewTableMapping.fields,
	entityIdField: OutputFieldKey,
	queryDocument: RyotQLDocument,
});

export const SavedViewLayouts = strictStruct({
	grid: SavedViewCardLayout,
	list: SavedViewCardLayout,
	table: SavedViewTableLayout,
});
export type SavedViewLayouts = typeof SavedViewLayouts.Type;

export const ListedSavedView = strictStruct({
	id: SavedViewId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	layouts: SavedViewLayouts,
	isDisabled: Schema.Boolean,
	pluginSlug: Schema.NullOr(PluginSlug),
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	layouts: SavedViewLayouts,
	pluginSlug: Schema.optional(PluginSlug),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	layouts: SavedViewLayouts,
	isDisabled: Schema.Boolean,
	pluginSlug: Schema.optional(PluginSlug),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	pluginSlug: Schema.optional(PluginSlug),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
