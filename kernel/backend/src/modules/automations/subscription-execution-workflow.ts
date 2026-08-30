import { BadRequest, DbError, NotFound, SandboxRunError } from "@ryot-app/contract/errors";
import { AutomationRuleId, SubscriptionRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const SubscriptionExecutionWorkflowError = Schema.Union([
	DbError,
	NotFound,
	BadRequest,
	SandboxRunError,
]);

const SubscriptionExecutionWorkflowPayloadSchema = Schema.Struct({
	ruleId: AutomationRuleId,
	occurrenceId: Schema.String,
	rowUserId: Schema.NullOr(UserId),
});

export type SubscriptionExecutionWorkflowPayload =
	typeof SubscriptionExecutionWorkflowPayloadSchema.Type;

export const SubscriptionExecutionWorkflow = Workflow.make("SubscriptionExecutionWorkflow", {
	error: SubscriptionExecutionWorkflowError satisfies DurableSchema,
	success: Schema.NullOr(SubscriptionRunId) satisfies DurableSchema,
	idempotencyKey: ({ ruleId, occurrenceId }) => `${occurrenceId}:${ruleId}`,
	payload: SubscriptionExecutionWorkflowPayloadSchema satisfies DurableSchema,
});
