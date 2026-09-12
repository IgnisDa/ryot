import { Schema } from "effect";

import { UserPreferencesPatch } from "../../schema/user-preferences";

export const UpdateUserPreferencesBody = UserPreferencesPatch;

export type UpdateUserPreferencesBody = typeof UpdateUserPreferencesBody.Type;

export const TwoFactorStatus = Schema.Struct({
	enabled: Schema.Boolean,
	available: Schema.Boolean,
});

export type TwoFactorStatus = typeof TwoFactorStatus.Type;
