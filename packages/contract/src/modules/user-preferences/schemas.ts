import { Schema } from "effect";

export const UserPreferences = Schema.Struct({
	isNsfw: Schema.Boolean,
	disableIntegrations: Schema.Boolean,
	language: Schema.NullOr(Schema.String),
});

export type UserPreferences = typeof UserPreferences.Type;

export const UpdateUserPreferencesBody = Schema.Struct({
	isNsfw: Schema.optional(Schema.Boolean),
	disableIntegrations: Schema.optional(Schema.Boolean),
	language: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateUserPreferencesBody = typeof UpdateUserPreferencesBody.Type;
