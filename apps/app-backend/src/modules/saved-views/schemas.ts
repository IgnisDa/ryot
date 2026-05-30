import { Schema } from "effect";

import {
	DisplayConfiguration,
	QueryComputedField,
	QueryEventJoin,
	QueryFilter,
	QueryRelationshipJoin,
	SavedViewSort,
} from "#lib/query-language";
import { SavedViewId, TrackerId } from "#lib/schema/brands";
import { strictStruct } from "#lib/schema/utils";

const SavedViewQueryDefinition = strictStruct({
	scope: Schema.Array(Schema.String),
	sort: Schema.optional(SavedViewSort),
	mode: Schema.optional(Schema.Literal("entities")),
	filter: Schema.optional(Schema.NullOr(QueryFilter)),
	eventJoins: Schema.optional(Schema.Array(QueryEventJoin)),
	computedFields: Schema.optional(Schema.Array(QueryComputedField)),
	relationshipJoins: Schema.optional(Schema.Array(QueryRelationshipJoin)),
});

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
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.NullOr(TrackerId),
});

export type ListedSavedView = typeof ListedSavedView.Type;

export const CreateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.optional(TrackerId),
});

export type CreateSavedViewBody = typeof CreateSavedViewBody.Type;

export const UpdateSavedViewBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	isDisabled: Schema.Boolean,
	accentColor: Schema.String,
	queryDefinition: SavedViewQueryDefinition,
	displayConfiguration: DisplayConfiguration,
	trackerId: Schema.optional(TrackerId),
});

export type UpdateSavedViewBody = typeof UpdateSavedViewBody.Type;

export const ReorderSavedViewsBody = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
	trackerId: Schema.optional(TrackerId),
});

export type ReorderSavedViewsBody = typeof ReorderSavedViewsBody.Type;

export const ReorderSavedViewsResponse = Schema.Struct({
	viewSlugs: Schema.Array(Schema.String),
});

export type ReorderSavedViewsResponse = typeof ReorderSavedViewsResponse.Type;
