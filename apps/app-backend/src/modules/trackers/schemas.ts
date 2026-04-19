import { Schema } from "effect";

export const ListedTracker = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	config: Schema.Unknown,
	isBuiltin: Schema.Boolean,
	isDisabled: Schema.Boolean,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	description: Schema.NullOr(Schema.String),
});

export type ListedTracker = typeof ListedTracker.Type;

export const CreateTrackerBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	accentColor: Schema.String,
	slug: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
});

export type CreateTrackerBody = typeof CreateTrackerBody.Type;

export const UpdateTrackerBody = Schema.Struct({
	isDisabled: Schema.Boolean,
	icon: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	accentColor: Schema.optional(Schema.String),
	description: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateTrackerBody = typeof UpdateTrackerBody.Type;

export const ReorderTrackersBody = Schema.Struct({
	trackerIds: Schema.Array(Schema.String),
});

export type ReorderTrackersBody = typeof ReorderTrackersBody.Type;

export const ReorderTrackersResponse = Schema.Struct({
	trackerIds: Schema.Array(Schema.String),
});

export type ReorderTrackersResponse = typeof ReorderTrackersResponse.Type;
