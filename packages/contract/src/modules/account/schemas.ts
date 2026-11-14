import { Schema } from "effect";

import { WriteAccess } from "../../oauth";
import { ApiKeyId } from "../../schema/brands";

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

export const API_KEY_NAME_MAX_LENGTH = 32;

export const API_KEY_MAX_EXPIRY_DAYS = 365;

export const CreateApiKeyBody = Schema.Struct({
	writeAccess: WriteAccess,
	name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(API_KEY_NAME_MAX_LENGTH)),
	expiresInDays: Schema.NullOr(
		Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: API_KEY_MAX_EXPIRY_DAYS })),
	),
});

export type CreateApiKeyBody = typeof CreateApiKeyBody.Type;

export const CreatedApiKey = Schema.Struct({ id: ApiKeyId, key: Schema.String });

export type CreatedApiKey = typeof CreatedApiKey.Type;
