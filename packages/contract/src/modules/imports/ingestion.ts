import { Schema } from "effect";

import { AccountGeneration } from "../../schema/account-generation";
import { ImportRunId, IntegrationId, UserId } from "../../schema/brands";
import { jsonValueSchema } from "../sandbox/wire";
import { ImportRunStatus, ingestionBlockReasonFields } from "./schemas";

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const IngestionScope = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	accountGeneration: AccountGeneration,
});
export type IngestionScope = typeof IngestionScope.Type;

export const IngestionReason = Schema.Struct({
	code: Schema.NonEmptyString,
	key: Schema.NullOr(Schema.String),
});
export type IngestionReason = typeof IngestionReason.Type;

export const IngestionBlockReason = Schema.Struct(ingestionBlockReasonFields);
export type IngestionBlockReason = typeof IngestionBlockReason.Type;

export const IngestionPlan = Schema.Struct({
	operation: Schema.NonEmptyString,
	selection: Schema.Record(Schema.String, jsonValueSchema),
});
export type IngestionPlan = typeof IngestionPlan.Type;

export const IngestionPins = Schema.Struct({
	scriptId: Schema.NonEmptyString,
	executionId: Schema.NonEmptyString,
	pluginRevisionId: Schema.NullOr(Schema.String),
	pluginConfigRevisionId: Schema.NullOr(Schema.String),
});
export type IngestionPins = typeof IngestionPins.Type;

export const IngestionOutcomeCounts = Schema.Struct({
	created: Count,
	updated: Count,
	skipped: Count,
	unchanged: Count,
	unsuccessful: Count,
});
export type IngestionOutcomeCounts = typeof IngestionOutcomeCounts.Type;

export const IngestionSummary = Schema.Array(
	Schema.Struct({
		counts: IngestionOutcomeCounts,
		unit: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
		recordKind: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
	}),
).pipe(Schema.check(Schema.isMaxLength(100)));
export type IngestionSummary = typeof IngestionSummary.Type;

export const IngestionActivity = Schema.Struct({
	completed: Count,
	id: Schema.NonEmptyString,
	unit: Schema.NonEmptyString,
	lastAdvancedAt: Schema.String,
	exactTotal: Schema.NullOr(Count),
	wait: Schema.NullOr(IngestionReason),
	batchId: Schema.NullOr(Schema.String),
	parentId: Schema.NullOr(Schema.String),
	kind: Schema.Literals(["reading", "preparing", "resolving", "writing", "finishing"]),
	state: Schema.Literals(["pending", "running", "waiting", "completed", "failed", "cancelled"]),
});
export type IngestionActivity = typeof IngestionActivity.Type;

export const IngestionPayload = Schema.Struct({
	byteSize: Count,
	locator: Schema.NonEmptyString,
	checksum: Schema.NonEmptyString,
});
export type IngestionPayload = typeof IngestionPayload.Type;

export const IngestionCapture = Schema.Struct({
	ordinal: Count,
	id: Schema.NonEmptyString,
	checkpoint: jsonValueSchema,
	payload: Schema.NullOr(IngestionPayload),
	phase: Schema.Literals(["collection", "application"]),
	state: Schema.Literals(["captured", "sealed", "released"]),
});
export type IngestionCapture = typeof IngestionCapture.Type;

export const IngestionBatch = Schema.Struct({
	ordinal: Count,
	id: Schema.NonEmptyString,
	summary: IngestionSummary,
	captureId: Schema.NonEmptyString,
	inputFingerprint: Schema.NonEmptyString,
	state: Schema.Literals(["pending", "preparing", "applying", "applied"]),
});
export type IngestionBatch = typeof IngestionBatch.Type;

export const IngestionAttribution = Schema.Struct({
	recordId: Schema.NonEmptyString,
	sourceLabel: Schema.NullOr(Schema.String),
	sourceIdentifier: Schema.NullOr(Schema.String),
});
export type IngestionAttribution = typeof IngestionAttribution.Type;

export const IngestionOutcome = Schema.Struct({
	attribution: IngestionAttribution,
	operationId: Schema.NonEmptyString,
	reason: Schema.NullOr(IngestionReason),
	inputFingerprint: Schema.NonEmptyString,
	receiptId: Schema.NullOr(Schema.String),
	unit: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
	recordKind: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(128))),
	result: Schema.Literals(["created", "updated", "unchanged", "skipped", "unsuccessful"]),
});
export type IngestionOutcome = typeof IngestionOutcome.Type;

export const IngestionIssue = Schema.Struct({
	reason: IngestionReason,
	id: Schema.NonEmptyString,
	recordKind: Schema.NonEmptyString,
	operationId: Schema.NullOr(Schema.String),
	severity: Schema.Literals(["warning", "error"]),
	attribution: Schema.NullOr(IngestionAttribution),
});
export type IngestionIssue = typeof IngestionIssue.Type;

export const IngestionRun = Schema.Struct({
	userId: UserId,
	id: ImportRunId,
	source: Schema.String,
	status: ImportRunStatus,
	acceptedAt: Schema.String,
	summary: IngestionSummary,
	collectionSealed: Schema.Boolean,
	plan: Schema.NullOr(IngestionPlan),
	pins: Schema.NullOr(IngestionPins),
	accountGeneration: AccountGeneration,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	integrationId: Schema.NullOr(IntegrationId),
	blockDeadline: Schema.NullOr(Schema.String),
	activities: Schema.Array(IngestionActivity),
	blockReasons: Schema.Array(IngestionBlockReason),
	pluginInstallationId: Schema.NullOr(Schema.String),
	executionKind: Schema.Literals(["source", "integration"]),
	expiryReason: Schema.NullOr(Schema.Literal("setup-deadline-expired")),
});
export type IngestionRun = typeof IngestionRun.Type;
