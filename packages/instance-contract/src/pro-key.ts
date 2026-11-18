import { Schema } from "effect";

export const ProKeyVerification = Schema.Struct({
	valid: Schema.Boolean,
	expiry: Schema.optional(Schema.DateTimeUtcFromString),
});
