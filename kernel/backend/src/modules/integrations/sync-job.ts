import { UserId } from "@ryot-app/contract/schema/brands";
import { Duration, Schema } from "effect";

import { makeJobKind } from "#platform/jobs/queue";

export const IntegrationSyncPayload = Schema.Struct({ userId: Schema.NullOr(UserId) });

export type IntegrationSyncPayload = typeof IntegrationSyncPayload.Type;

export const IntegrationSyncJob = makeJobKind("integration-sync", {
	concurrency: 2,
	lease: Duration.minutes(5),
	payload: IntegrationSyncPayload,
});
