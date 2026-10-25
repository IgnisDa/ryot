import { Schema } from "effect";

export const TwoFactorStatus = Schema.Struct({
	enabled: Schema.Boolean,
	available: Schema.Boolean,
});

export type TwoFactorStatus = typeof TwoFactorStatus.Type;
