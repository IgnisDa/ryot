import { Schema } from "effect";

import { EntitySchemaSlug, EventSchemaSlug, ImportRunId } from "../../schema/brands";
import { jsonValueSchema } from "../sandbox/wire";
import { importRunFailureStages } from "./types";

export const ImportRunStatus = Schema.Literals([
	"pending",
	"running",
	"cancelling",
	"completed",
	"failed",
	"cancelled",
]);
export type ImportRunStatus = typeof ImportRunStatus.Type;

export const ImportRequestFailureReason = Schema.Union([
	Schema.Struct({ source: Schema.String, code: Schema.Literal("source-not-found") }),
	Schema.Struct({ source: Schema.String, code: Schema.Literal("workflow-unavailable") }),
	Schema.Struct({ field: Schema.NullOr(Schema.String), code: Schema.Literal("invalid-input") }),
	Schema.Struct({ field: Schema.String, code: Schema.Literal("upload-unavailable") }),
	Schema.Struct({ operation: Schema.String, code: Schema.Literal("queue-unavailable") }),
	Schema.Struct({
		allowedExtensions: Schema.Array(Schema.String),
		code: Schema.Literal("unsupported-file-extension"),
	}),
	Schema.Struct({
		source: Schema.String,
		code: Schema.Literal("source-not-configured"),
		missingConfigKeys: Schema.Array(Schema.String),
	}),
]);

export type ImportRequestFailureReason = typeof ImportRequestFailureReason.Type;

export class ImportRequestError extends Schema.TaggedError<ImportRequestError>()(
	"ImportRequestError",
	{ reason: ImportRequestFailureReason },
) {}

export class ImportNotFoundError extends Schema.TaggedError<ImportNotFoundError>()(
	"ImportNotFoundError",
	{ reason: Schema.Struct({ runId: ImportRunId, code: Schema.Literal("run-not-found") }) },
) {}

export const ImportConflictReason = Schema.Union([
	Schema.Struct({ runId: ImportRunId, code: Schema.Literal("submission-key-conflict") }),
	Schema.Struct({
		runId: ImportRunId,
		status: ImportRunStatus,
		code: Schema.Literal("run-not-cancellable"),
	}),
	Schema.Struct({
		runId: ImportRunId,
		status: ImportRunStatus,
		code: Schema.Literal("run-not-terminal"),
	}),
]);
export type ImportConflictReason = typeof ImportConflictReason.Type;

export class ImportConflictError extends Schema.TaggedError<ImportConflictError>()(
	"ImportConflictError",
	{ reason: ImportConflictReason },
) {}

export const ImportRunFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("pro-key-required") }),
	Schema.Struct({ code: Schema.Literal("source-fetch-failed") }),
	Schema.Struct({ code: Schema.Literal("event-policy-failed") }),
	Schema.Struct({ code: Schema.Literal("integration-disabled") }),
	Schema.Struct({ code: Schema.Literal("integrations-disabled") }),
	Schema.Struct({ code: Schema.Literal("integration-not-found") }),
	Schema.Struct({ code: Schema.Literal("database-commit-failed") }),
	Schema.Struct({ code: Schema.Literal("provider-details-failed") }),
	Schema.Struct({ code: Schema.Literal("provider-resolution-failed") }),
	Schema.Struct({ code: Schema.Literal("input-transformation-failed") }),
	Schema.Struct({ operation: Schema.String, code: Schema.Literal("queue-unavailable") }),
	Schema.Struct({ operation: Schema.String, code: Schema.Literal("unexpected-failure") }),
]);

export type ImportRunFailureReason = typeof ImportRunFailureReason.Type;

export const ImportRunFailureSchema = Schema.Struct({
	id: Schema.String,
	runId: ImportRunId,
	createdAt: Schema.String,
	itemIndex: Schema.Finite,
	reason: ImportRunFailureReason,
	sourceLabel: Schema.NullOr(Schema.String),
	sourceIdentifier: Schema.NullOr(Schema.String),
	eventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	entitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
	stage: Schema.Literals([...importRunFailureStages]),
});

export const ImportRunFailuresExport = Schema.Struct({
	runId: ImportRunId,
	source: Schema.String,
	failures: Schema.Array(ImportRunFailureSchema),
});

export type ImportRunFailuresExport = typeof ImportRunFailuresExport.Type;

export const importInternalPropertyNames: ReadonlySet<string> = new Set([
	"integrationId",
	"integrationContext",
	"integrationScriptSlug",
]);

export const isImportUploadTokenField = (field: string) =>
	field === "uploadToken" || field.endsWith("UploadToken");

const InputSummary = Schema.Record(Schema.String, Schema.Unknown);

export const ListedImportRun = Schema.Struct({
	id: ImportRunId,
	source: Schema.String,
	status: ImportRunStatus,
	progress: Schema.Finite,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Finite,
	inputSummary: InputSummary,
	importedItems: Schema.Finite,
	processedItems: Schema.Finite,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	totalItems: Schema.NullOr(Schema.Finite),
	failureReason: Schema.NullOr(ImportRunFailureReason),
});

export type ListedImportRun = typeof ListedImportRun.Type;

export const CreateImportRunBody = Schema.StructWithRest(
	Schema.Struct({ source: Schema.NonEmptyString }),
	[Schema.Record(Schema.String, jsonValueSchema)],
).pipe(Schema.annotate({ identifier: "CreateImportRunBody" }));

export type CreateImportRunBody = typeof CreateImportRunBody.Type;
