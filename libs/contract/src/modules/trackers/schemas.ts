import { Schema } from "effect";

export const ListedTracker = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	config: Schema.Unknown,
	isDisabled: Schema.Boolean,
	sortOrder: Schema.Number,
	accentColor: Schema.String,
	description: Schema.NullOr(Schema.String),
	entitySchemaSlugs: Schema.Array(Schema.String),
});

export type ListedTracker = typeof ListedTracker.Type;

export const UpdateTrackerStateBody = Schema.Struct({
	config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	sortOrder: Schema.optional(Schema.Number),
	isDisabled: Schema.optional(Schema.Boolean),
});

export type UpdateTrackerStateBody = typeof UpdateTrackerStateBody.Type;
