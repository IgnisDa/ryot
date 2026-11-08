import { Schema } from "effect";

export const TwoFactorStatus = Schema.Struct({
	enabled: Schema.Boolean,
	available: Schema.Boolean,
});

export type TwoFactorStatus = typeof TwoFactorStatus.Type;

export const ACCOUNT_NAME_MAX_LENGTH = 100;

export const AccountName = Schema.Trim.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(ACCOUNT_NAME_MAX_LENGTH),
);
