import { Schema } from "effect";

import { DisplayConfiguration } from "../../display-configuration";
import { SavedViewId, TrackerSlug } from "../../schema/brands";
import { QueryDocument } from "../query-engine/language";

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
	accentColor: Schema.String,
	queryDocument: QueryDocument,
	trackerSlug: Schema.NullOr(TrackerSlug),
	displayConfiguration: DisplayConfiguration,
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	queryDocument: QueryDocument,
	displayConfiguration: DisplayConfiguration,
	trackerSlug: Schema.optional(TrackerSlug),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	queryDocument: QueryDocument,
	displayConfiguration: DisplayConfiguration,
	trackerSlug: Schema.optional(TrackerSlug),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	trackerSlug: Schema.optional(TrackerSlug),
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
