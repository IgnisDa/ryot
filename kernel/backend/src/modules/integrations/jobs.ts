import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";

import { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";

export const IntegrationWebhookDelivery = Schema.Struct({
	rawBody: Schema.String,
	contentType: Schema.String,
});

export type IntegrationWebhookDelivery = typeof IntegrationWebhookDelivery.Type;

export const IntegrationRunJobData = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	integrationId: IntegrationId,
	accountGeneration: AccountGeneration,
});

export type IntegrationRunJobData = typeof IntegrationRunJobData.Type;

export const IntegrationSyncRun = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	integrationId: IntegrationId,
	accountGeneration: AccountGeneration,
});

export type IntegrationSyncRun = typeof IntegrationSyncRun.Type;
export const IntegrationRecoveryPage = Schema.Struct({
	runs: Schema.Array(IntegrationSyncRun),
	next: Schema.NullOr(IngestionRecoveryCursor),
});

export class IntegrationRunError extends Schema.TaggedError<IntegrationRunError>()(
	"IntegrationRunError",
	{ message: Schema.String },
) {}
