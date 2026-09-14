import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

export const IntegrationWebhookDelivery = Schema.Struct({
	rawBody: Schema.String,
	contentType: Schema.String,
});

export type IntegrationWebhookDelivery = typeof IntegrationWebhookDelivery.Type;

export const IntegrationRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	integrationId: IntegrationId,
	webhook: Schema.optional(IntegrationWebhookDelivery),
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
