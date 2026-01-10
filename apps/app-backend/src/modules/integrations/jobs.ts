import { Schema } from "effect";

import { ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";

export const IntegrationRunJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	integrationId: IntegrationId,
	rawBody: Schema.optional(Schema.String),
	contentType: Schema.optional(Schema.String),
});

export type IntegrationRunJobData = typeof IntegrationRunJobData.Type;

export class IntegrationRunError extends Schema.TaggedError<IntegrationRunError>()(
	"IntegrationRunError",
	{ message: Schema.String },
) {}
