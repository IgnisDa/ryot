import { Schema } from "effect";

export const IntegrationRunJobData = Schema.Struct({
	runId: Schema.String,
	userId: Schema.String,
	integrationId: Schema.String,
	rawBody: Schema.optional(Schema.String),
	contentType: Schema.optional(Schema.String),
});

export type IntegrationRunJobData = typeof IntegrationRunJobData.Type;

export class IntegrationRunError extends Schema.TaggedError<IntegrationRunError>()(
	"IntegrationRunError",
	{ message: Schema.String },
) {}
