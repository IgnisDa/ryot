import { Schema } from "effect";

import { DisplayConfiguration, SavedViewQueryDefinition } from "../../lib/query-language";

export const ListedSavedView = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.NullOr(Schema.String),
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.optional(Schema.String),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.optional(Schema.String),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	trackerId: Schema.optional(Schema.String),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
