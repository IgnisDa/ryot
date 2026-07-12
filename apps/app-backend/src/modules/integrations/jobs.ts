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

export const IntegrationReconciliationRun = Schema.Struct({
	runId: ImportRunId,
	userId: UserId,
	integrationId: IntegrationId,
});

export type IntegrationReconciliationRun = typeof IntegrationReconciliationRun.Type;

export class IntegrationRunError extends Schema.TaggedErrorClass<IntegrationRunError>()(
	"IntegrationRunError",
	{ message: Schema.String },
) {}
