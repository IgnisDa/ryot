import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { strictStruct } from "../wire";

export const submissionOptionsSchema = strictStruct({
	submittedAt: Schema.String,
	idempotencyKey: Schema.String.pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(128)),
	),
});
