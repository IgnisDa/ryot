import { Schema } from "effect";

import {
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	PluginId,
	PluginRevisionId,
	UserId,
} from "../../schema/brands";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import {
	AutomationRunAttempt,
	AutomationRunSkipReason,
	AutomationRunStatus,
	AutomationTriggerKind,
} from "./lifecycle";

export const AUTOMATION_HISTORY_LIMITS = {
	maxAttempts: 50,
	attemptBytes: 8_192,
	defaultPageSize: 25,
	payloadBytes: 32_768,
} as const;

export const AutomationRetryUnavailableReason = Schema.Literals([
	"before-policy",
	"not-failed",
	"expired",
	"missing-artifact",
]);
export const AutomationRetryEligibility = strictStruct({
	reason: Schema.NullOr(AutomationRetryUnavailableReason),
});
export type AutomationRetryEligibility = typeof AutomationRetryEligibility.Type;

export const AutomationHistoryRun = strictStruct({
	id: AutomationRunId,
	queuedAt: IsoUtcString,
	hookName: Schema.String,
	status: AutomationRunStatus,
	hookSlug: AutomationHookSlug,
	triggerId: AutomationTriggerId,
	artifactsExpireAt: IsoUtcString,
	pluginId: Schema.NullOr(PluginId),
	triggerKind: AutomationTriggerKind,
	executionUserId: Schema.NullOr(UserId),
	startedAt: Schema.NullOr(IsoUtcString),
	finishedAt: Schema.NullOr(IsoUtcString),
	pluginName: Schema.NullOr(Schema.String),
	nextAttemptAt: Schema.NullOr(IsoUtcString),
	stage: Schema.Literals(["before", "after"]),
	pluginRevisionId: Schema.NullOr(PluginRevisionId),
	skipReason: Schema.NullOr(AutomationRunSkipReason),
	delivery: Schema.Literals(["policy", "required", "async"]),
	attemptCount: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
});

export type AutomationHistoryRun = typeof AutomationHistoryRun.Type;

const {
	returnedValue: _returnedValue,
	workflowExecutionId: _workflowExecutionId,
	...attemptFields
} = AutomationRunAttempt.fields;

export const AutomationHistoryAttempt = strictStruct({
	...attemptFields,
	artifactsTruncated: Schema.Boolean,
});

export type AutomationHistoryAttempt = typeof AutomationHistoryAttempt.Type;

export const AutomationHistoryRetryBody = strictStruct({
	expectedAttemptCount: AutomationRunAttempt.fields.attemptNumber,
});

export type AutomationHistoryRetryBody = typeof AutomationHistoryRetryBody.Type;

export const AutomationHistoryRetryResult = strictStruct({
	runId: AutomationRunId,
	dispatch: Schema.Literals(["submitted", "pending"]),
	attemptNumber: AutomationRunAttempt.fields.attemptNumber,
});

export type AutomationHistoryRetryResult = typeof AutomationHistoryRetryResult.Type;

export class AutomationHistoryNotFound extends Schema.TaggedError<AutomationHistoryNotFound>()(
	"AutomationHistoryNotFound",
	{ reason: strictStruct({ runId: AutomationRunId, code: Schema.Literal("run-not-found") }) },
) {}

export class AutomationHistoryRetryConflict extends Schema.TaggedError<AutomationHistoryRetryConflict>()(
	"AutomationHistoryRetryConflict",
	{
		reason: strictStruct({
			runId: AutomationRunId,
			code: Schema.Union([AutomationRetryUnavailableReason, Schema.Literal("retry-conflict")]),
		}),
	},
) {}

export class AutomationHistoryInternalError extends Schema.TaggedError<AutomationHistoryInternalError>()(
	"AutomationHistoryInternalError",
	{ reason: strictStruct({ code: Schema.Literal("history-unavailable") }) },
) {}
