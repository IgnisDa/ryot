import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationPolicyBatchOutput,
	AutomationPolicyOutput,
	AutomationPolicyPatch,
	AutomationRunAttempt,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId, EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#boot/workflow-engine";

import { automationAttemptIdentity } from "./attempt-repository";

export const AutomationAttemptResult = Schema.Struct({
	id: AutomationRunAttempt.fields.id,
	runId: AutomationRunAttempt.fields.runId,
	status: AutomationRunAttempt.fields.status,
	timing: AutomationRunAttempt.fields.timing,
	retryable: AutomationRunAttempt.fields.retryable,
	startedAt: AutomationRunAttempt.fields.startedAt,
	finishedAt: AutomationRunAttempt.fields.finishedAt,
	failureKind: AutomationRunAttempt.fields.failureKind,
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
	workflowExecutionId: AutomationRunAttempt.fields.workflowExecutionId,
});
export type AutomationAttemptResult = typeof AutomationAttemptResult.Type;
export const AutomationPolicyRunOutput = Schema.Union([
	AutomationPolicyOutput,
	AutomationPolicyBatchOutput,
]);

export const AutomationRunWorkflowResult = Schema.Union([
	Schema.Struct({
		attempt: AutomationAttemptResult,
		policyOutput: Schema.NullOr(AutomationPolicyRunOutput),
	}),
	Schema.Struct({ attempt: Schema.Null, policyOutput: Schema.Null }),
]);
export type AutomationRunWorkflowResult = typeof AutomationRunWorkflowResult.Type;

export const AutomationRunWorkflowPayload = Schema.Struct({
	runId: AutomationRunId,
	acceptedPatches: Schema.Array(AutomationPolicyPatch),
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
	activeItemIdentities: Schema.optional(Schema.Array(Schema.String)),
	acceptedReferences: Schema.optional(Schema.Record(EntityId, AutomationEntityDraft)),
	acceptedBatchPatches: Schema.optional(
		Schema.Record(Schema.String, Schema.Array(AutomationPolicyPatch)),
	),
});
export type AutomationRunWorkflowPayload = typeof AutomationRunWorkflowPayload.Type;

export const AutomationRunWorkflow = Workflow.make("AutomationRunWorkflow", {
	error: DbError satisfies DurableSchema,
	success: AutomationRunWorkflowResult satisfies DurableSchema,
	payload: AutomationRunWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ runId, attemptNumber }) =>
		automationAttemptIdentity(runId, attemptNumber).workflowExecutionId,
});

export const settledAutomationRunResult = (
	stage: "after" | "before",
	attempt: AutomationRunAttempt,
): Effect.Effect<AutomationRunWorkflowResult, DbError> =>
	Effect.map(
		stage === "before" && attempt.status === "succeeded"
			? Schema.decodeUnknownEffect(AutomationPolicyRunOutput)(attempt.returnedValue).pipe(
					Effect.mapError(
						() => new DbError({ message: "Automation policy outcome is unavailable" }),
					),
				)
			: Effect.succeed(null),
		(policyOutput) => ({
			policyOutput,
			attempt: Schema.decodeSync(AutomationAttemptResult)(attempt),
		}),
	);

export const AutomationRunSettlement = Schema.Union([
	Schema.TaggedStruct("completed", { result: AutomationRunWorkflowResult }),
	Schema.TaggedStruct("pending", {}),
]);
export type AutomationRunSettlement = typeof AutomationRunSettlement.Type;
