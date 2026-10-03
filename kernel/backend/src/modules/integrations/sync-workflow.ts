import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const IntegrationSyncPayload = Schema.Struct({
	executionId: Schema.String,
	userId: Schema.NullOr(UserId),
	accountGeneration: Schema.NullOr(AccountGeneration),
});

export type IntegrationSyncPayload = typeof IntegrationSyncPayload.Type;

export const IntegrationSyncWorkflow = Workflow.make("IntegrationSyncWorkflow", {
	error: Schema.Never satisfies DurableSchema,
	success: Schema.Void satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: IntegrationSyncPayload satisfies DurableSchema,
});
