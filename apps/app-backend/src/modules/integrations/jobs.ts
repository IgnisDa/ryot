import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

export const IntegrationRunJobData = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	integrationId: IntegrationId,
	rawBody: Schema.optional(Schema.String),
	contentType: Schema.optional(Schema.String),
});

export type IntegrationRunJobData = typeof IntegrationRunJobData.Type;

export const IntegrationSyncRun = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	integrationId: IntegrationId,
});

export type IntegrationSyncRun = typeof IntegrationSyncRun.Type;

export class IntegrationRunError extends Schema.TaggedError<IntegrationRunError>()(
	"IntegrationRunError",
	{ message: Schema.String },
) {}
