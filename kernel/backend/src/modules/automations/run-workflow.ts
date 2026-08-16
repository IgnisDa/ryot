import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationPolicyOutput,
	AutomationRequestPayload,
	AutomationRunAttempt,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

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
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
	policyPayload: Schema.optional(AutomationRequestPayload),
});
export type AutomationRunWorkflowPayload = typeof AutomationRunWorkflowPayload.Type;

export const AutomationRunWorkflow = Workflow.make("AutomationRunWorkflow", {
	error: DbError satisfies DurableSchema,
	success: AutomationRunWorkflowResult satisfies DurableSchema,
	payload: AutomationRunWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ runId, attemptNumber }) =>
		automationAttemptIdentity(runId, attemptNumber).workflowExecutionId,
});
