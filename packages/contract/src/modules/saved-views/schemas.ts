import { Schema } from "effect";

import { PluginSlug, SavedViewId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { OutputFieldKey, RyotQLDocument } from "../ryotql/language";

const SavedViewCardDisplayConfiguration = strictStruct({
	titleField: OutputFieldKey,
	imageField: Schema.NullOr(OutputFieldKey),
	eyebrowField: Schema.NullOr(OutputFieldKey),
	calloutField: Schema.NullOr(OutputFieldKey),
	primarySubtitleField: Schema.NullOr(OutputFieldKey),
	secondarySubtitleField: Schema.NullOr(OutputFieldKey),
});

const SavedViewTableDisplayConfiguration = strictStruct({
	columns: Schema.NonEmptyArray(strictStruct({ label: Schema.String, field: OutputFieldKey })),
});

export const SavedViewDisplayConfiguration = strictStruct({
	entityIdField: OutputFieldKey,
	grid: SavedViewCardDisplayConfiguration,
	list: SavedViewCardDisplayConfiguration,
	table: SavedViewTableDisplayConfiguration,
});

export type SavedViewDisplayConfiguration = typeof SavedViewDisplayConfiguration.Type;

export const ListedSavedView = Schema.Struct({
	id: SavedViewId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	queryDocument: RyotQLDocument,
	pluginSlug: Schema.NullOr(PluginSlug),
	displayConfiguration: SavedViewDisplayConfiguration,
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	queryDocument: RyotQLDocument,
	pluginSlug: Schema.optional(PluginSlug),
	displayConfiguration: SavedViewDisplayConfiguration,
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	queryDocument: RyotQLDocument,
	pluginSlug: Schema.optional(PluginSlug),
	displayConfiguration: SavedViewDisplayConfiguration,
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
