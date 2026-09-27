import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationPolicyOutput,
	AutomationPolicyPatch,
	AutomationRunAttempt,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

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

export const AutomationRunWorkflowResult = Schema.Union([
	Schema.Struct({
		attempt: AutomationAttemptResult,
		policyOutput: Schema.NullOr(AutomationPolicyOutput),
	}),
	Schema.Struct({ attempt: Schema.Null, policyOutput: Schema.Null }),
]);
export type AutomationRunWorkflowResult = typeof AutomationRunWorkflowResult.Type;

export const AutomationRunWorkflowPayload = Schema.Struct({
	runId: AutomationRunId,
	acceptedPatches: Schema.Array(AutomationPolicyPatch),
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
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
			? Schema.decodeUnknownEffect(AutomationPolicyOutput)(attempt.returnedValue).pipe(
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

export const AutomationObservation = Schema.Union([
	Schema.TaggedStruct("completed", { result: AutomationRunWorkflowResult }),
	Schema.TaggedStruct("expired", {}),
]);
export type AutomationObservation = typeof AutomationObservation.Type;

export const AutomationObservationWorkflowPayload = Schema.Struct({
	...AutomationRunWorkflowPayload.fields,
	deadline: Schema.Finite,
});
export type AutomationObservationWorkflowPayload = typeof AutomationObservationWorkflowPayload.Type;

export const automationObservationExecutionId = (runId: AutomationRunId, attemptNumber: number) =>
	`${automationAttemptIdentity(runId, attemptNumber).workflowExecutionId}-observation`;

// A short-lived observer owns the deadline race, so a losing clock or a late run exit only reaches a
// completed workflow and never wakes the long-lived workflow that waits for the outcome.
export const AutomationObservationWorkflow = Workflow.make("AutomationObservationWorkflow", {
	error: DbError satisfies DurableSchema,
	success: AutomationObservation satisfies DurableSchema,
	payload: AutomationObservationWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ runId, attemptNumber }) =>
		automationObservationExecutionId(runId, attemptNumber),
});
