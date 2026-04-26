import { Schema } from "effect";

import { UserId } from "../../schema/brands";

export const UserPreferences = Schema.Struct({
	allowNsfw: Schema.Boolean,
	disableIntegrations: Schema.Boolean,
	language: Schema.NullOr(Schema.String),
});

export type UserPreferences = typeof UserPreferences.Type;

export const UserSettings = Schema.Struct({
	id: UserId,
	name: Schema.String,
	email: Schema.String,
	preferences: UserPreferences,
	image: Schema.NullOr(Schema.String),
});

export type UserSettings = typeof UserSettings.Type;

export const UpdateUserPreferencesBody = Schema.Struct({
	allowNsfw: Schema.optional(Schema.Boolean),
	disableIntegrations: Schema.optional(Schema.Boolean),
	language: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateUserPreferencesBody = typeof UpdateUserPreferencesBody.Type;

export const UserAvatar = Schema.Struct({ image: Schema.String });

export type UserAvatar = typeof UserAvatar.Type;
