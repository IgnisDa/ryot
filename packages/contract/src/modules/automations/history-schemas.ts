import { Schema } from "effect";

import {
	AutomationHookSlug,
	AutomationRunId,
	AutomationTriggerId,
	PluginId,
	PluginRevisionId,
	UserId,
} from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import {
	AutomationRunAttempt,
	AutomationRunSkipReason,
	AutomationRunStatus,
	AutomationTriggerKind,
} from "./lifecycle";

export const AUTOMATION_HISTORY_LIMITS = {
	maxAttempts: 50,
	maxPageSize: 100,
	attemptBytes: 8_192,
	defaultPageSize: 25,
	payloadBytes: 32_768,
} as const;

export const AutomationHistoryCursor = strictStruct({
	id: AutomationRunId,
	queuedAt: IsoUtcString,
});

export type AutomationHistoryCursor = typeof AutomationHistoryCursor.Type;

export const AutomationHistoryFilters = strictStruct({
	to: Schema.optional(IsoUtcString),
	from: Schema.optional(IsoUtcString),
	pluginId: Schema.optional(PluginId),
	status: Schema.optional(AutomationRunStatus),
	hookSlug: Schema.optional(AutomationHookSlug),
	triggerId: Schema.optional(AutomationTriggerId),
	stage: Schema.optional(Schema.Literals(["before", "after"])),
	cursor: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(512)))),
	limit: Schema.optional(
		Schema.NumberFromString.pipe(
			Schema.check(
				Schema.isInt(),
				Schema.isBetween({ minimum: 1, maximum: AUTOMATION_HISTORY_LIMITS.maxPageSize }),
			),
		),
	),
});
export type AutomationHistoryFilters = typeof AutomationHistoryFilters.Type;

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

export const AutomationHistoryPage = strictStruct({
	nextCursor: Schema.NullOr(Schema.String),
	items: Schema.Array(AutomationHistoryRun).pipe(
		Schema.check(Schema.isMaxLength(AUTOMATION_HISTORY_LIMITS.maxPageSize)),
	),
});

export type AutomationHistoryPage = typeof AutomationHistoryPage.Type;

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

export const AutomationHistoryDetail = strictStruct({
	run: AutomationHistoryRun,
	attemptsTruncated: Schema.Boolean,
	retryEligibility: AutomationRetryEligibility,
	attempts: Schema.Array(AutomationHistoryAttempt).pipe(
		Schema.check(Schema.isMaxLength(AUTOMATION_HISTORY_LIMITS.maxAttempts)),
	),
	trigger: strictStruct({
		id: AutomationTriggerId,
		occurredAt: IsoUtcString,
		kind: AutomationTriggerKind,
		payloadTruncated: Schema.Boolean,
		payload: Schema.NullOr(JsonValue),
		payloadPrunedAt: Schema.NullOr(IsoUtcString),
	}),
});

export type AutomationHistoryDetail = typeof AutomationHistoryDetail.Type;

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

export class AutomationHistoryRequestError extends Schema.TaggedError<AutomationHistoryRequestError>()(
	"AutomationHistoryRequestError",
	{ reason: strictStruct({ code: Schema.Literals(["invalid-cursor", "invalid-filters"]) }) },
) {}

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
