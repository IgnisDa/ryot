import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationPolicyBatchOutput,
	AutomationPolicyOutput,
	AutomationPolicyPatch,
	AutomationRunAttempt,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { AutomationRunId, EntityId } from "@ryot-app/contract/schema/brands";
import { Duration, Effect, Schema, Struct } from "effect";

import { makeJobKind } from "#platform/jobs/queue";

export const AutomationAttemptResult = Schema.Struct({
	id: AutomationRunAttempt.fields.id,
	runId: AutomationRunAttempt.fields.runId,
	status: AutomationRunAttempt.fields.status,
	timing: AutomationRunAttempt.fields.timing,
	retryable: AutomationRunAttempt.fields.retryable,
	startedAt: AutomationRunAttempt.fields.startedAt,
	finishedAt: AutomationRunAttempt.fields.finishedAt,
	failureKind: AutomationRunAttempt.fields.failureKind,
	executionId: AutomationRunAttempt.fields.executionId,
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
});
export type AutomationAttemptResult = typeof AutomationAttemptResult.Type;
export const automationAttemptResult = (attempt: AutomationRunAttempt): AutomationAttemptResult =>
	Struct.pick(attempt, Struct.keys(AutomationAttemptResult.fields));
export const AutomationPolicyRunOutput = Schema.Union([
	AutomationPolicyOutput,
	AutomationPolicyBatchOutput,
]);

export const AutomationRunResult = Schema.Union([
	Schema.Struct({
		attempt: AutomationAttemptResult,
		policyOutput: Schema.NullOr(AutomationPolicyRunOutput),
	}),
	Schema.Struct({ attempt: Schema.Null, policyOutput: Schema.Null }),
]);
export type AutomationRunResult = typeof AutomationRunResult.Type;

export const AutomationRunPayload = Schema.Struct({
	runId: AutomationRunId,
	acceptedPatches: Schema.Array(AutomationPolicyPatch),
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
	activeItemIdentities: Schema.optional(Schema.Array(Schema.String)),
	acceptedReferences: Schema.optional(Schema.Record(EntityId, AutomationEntityDraft)),
	acceptedBatchPatches: Schema.optional(
		Schema.Record(Schema.String, Schema.Array(AutomationPolicyPatch)),
	),
});
export type AutomationRunPayload = typeof AutomationRunPayload.Type;

export const AutomationRunJob = makeJobKind("automation-run", {
	concurrency: 16,
	backoff: Duration.seconds(2),
	payload: AutomationRunPayload,
});

export const settledAutomationRunResult = (
	stage: "after" | "before",
	attempt: AutomationRunAttempt,
): Effect.Effect<AutomationRunResult, DbError> =>
	Effect.map(
		stage === "before" && attempt.status === "succeeded"
			? Schema.decodeUnknownEffect(AutomationPolicyRunOutput)(attempt.returnedValue).pipe(
					Effect.mapError(
						() => new DbError({ message: "Automation policy outcome is unavailable" }),
					),
				)
			: Effect.succeed(null),
		(policyOutput) => ({ policyOutput, attempt: automationAttemptResult(attempt) }),
	);

export const AutomationRunSettlement = Schema.Union([
	Schema.TaggedStruct("completed", { result: AutomationRunResult }),
	Schema.TaggedStruct("pending", {}),
]);
export type AutomationRunSettlement = typeof AutomationRunSettlement.Type;
