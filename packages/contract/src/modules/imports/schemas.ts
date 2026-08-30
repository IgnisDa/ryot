import { Schema } from "effect";

import { ImportRunId } from "../../schema/brands";
import { RunStatus } from "../../schema/run-status";
import { PluginImportSource } from "../plugins/manifest";
import { jsonValueSchema } from "../sandbox/wire";

export const ImportRequestFailureReason = Schema.Union([
	Schema.Struct({ source: Schema.String, code: Schema.Literal("source-not-found") }),
	Schema.Struct({ source: Schema.String, code: Schema.Literal("workflow-unavailable") }),
	Schema.Struct({ field: Schema.NullOr(Schema.String), code: Schema.Literal("invalid-input") }),
	Schema.Struct({ field: Schema.String, code: Schema.Literal("upload-unavailable") }),
	Schema.Struct({ operation: Schema.String, code: Schema.Literal("queue-unavailable") }),
	Schema.Struct({ runId: ImportRunId, code: Schema.Literal("run-not-found") }),
	Schema.Struct({
		allowedExtensions: Schema.Array(Schema.String),
		code: Schema.Literal("unsupported-file-extension"),
	}),
	Schema.Struct({
		source: Schema.String,
		code: Schema.Literal("source-not-configured"),
		missingConfigKeys: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		status: RunStatus,
		runId: ImportRunId,
		code: Schema.Literal("run-not-terminal"),
	}),
]);

export type ImportRequestFailureReason = typeof ImportRequestFailureReason.Type;

export class ImportRequestError extends Schema.TaggedError<ImportRequestError>()(
	"ImportRequestError",
	{ reason: ImportRequestFailureReason },
) {}

export class ImportNotFoundError extends Schema.TaggedError<ImportNotFoundError>()(
	"ImportNotFoundError",
	{ reason: ImportRequestFailureReason },
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

export const importInternalPropertyNames: ReadonlySet<string> = new Set([
	"integrationId",
	"integrationContext",
	"integrationScriptSlug",
]);

export const isImportUploadTokenField = (field: string) =>
	field === "uploadToken" || field.endsWith("UploadToken");

const InputSummary = Schema.Record(Schema.String, Schema.Unknown);

export const ListedImportSource = Schema.Struct({
	...PluginImportSource.fields,
	pluginSlug: Schema.String,
	isStartable: Schema.Boolean,
	missingPluginConfigKeys: Schema.Array(Schema.String),
});

export type ListedImportSource = typeof ListedImportSource.Type;

export const ListedImportRun = Schema.Struct({
	id: ImportRunId,
	status: RunStatus,
	source: Schema.String,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	inputSummary: InputSummary,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	startedAt: Schema.NullOr(Schema.String),
	finishedAt: Schema.NullOr(Schema.String),
	totalItems: Schema.NullOr(Schema.Number),
	failureReason: Schema.NullOr(ImportRunFailureReason),
});

export type ListedImportRun = typeof ListedImportRun.Type;

export const CreateImportRunBody = Schema.StructWithRest(
	Schema.Struct({ source: Schema.NonEmptyString }),
	[Schema.Record(Schema.String, jsonValueSchema)],
).pipe(Schema.annotate({ identifier: "CreateImportRunBody" }));

export type CreateImportRunBody = typeof CreateImportRunBody.Type;
