import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Schema } from "effect";

import { EntitySchemaSlug, EventSchemaSlug, ImportRunId } from "../../schema/brands";
import { importRunFailureStages, importRunStatuses } from "./types";

const ImportRunStatus = Schema.Literal(...importRunStatuses);

export const ImportRunFailureStage = Schema.Literal(...importRunFailureStages);

const InputSummary = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const ListedImportRun = Schema.Struct({
	id: ImportRunId,
	source: Schema.String,
	status: ImportRunStatus,
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
	errorSummary: Schema.NullOr(Schema.String),
});

export type ListedImportRun = typeof ListedImportRun.Type;

const ListedImportRunFailure = Schema.Struct({
	id: Schema.String,
	runId: ImportRunId,
	message: Schema.String,
	createdAt: Schema.String,
	itemIndex: Schema.Number,
	stage: ImportRunFailureStage,
	context: Schema.NullOr(InputSummary),
	sourceLabel: Schema.NullOr(Schema.String),
	sourceIdentifier: Schema.NullOr(Schema.String),
	eventSchemaSlug: Schema.NullOr(EventSchemaSlug),
	entitySchemaSlug: Schema.NullOr(EntitySchemaSlug),
});

export type ListedImportRunFailure = typeof ListedImportRunFailure.Type;

export const DetailedImportRun = Schema.Struct({
	...ListedImportRun.fields,
	failures: Schema.Struct({
		page: Schema.Number,
		total: Schema.Number,
		limit: Schema.Number,
		items: Schema.Array(ListedImportRunFailure),
	}),
});

export type DetailedImportRun = typeof DetailedImportRun.Type;

export const CreateImportRunBody = Schema.Struct(
	{ source: Schema.NonEmptyString },
	Schema.Record({ key: Schema.String, value: jsonValueSchema }),
).pipe(Schema.annotations({ identifier: "CreateImportRunBody" }));

export type CreateImportRunBody = typeof CreateImportRunBody.Type;

export const GetImportRunParams = Schema.Struct({
	page: Schema.optional(Schema.NumberFromString),
	limit: Schema.optional(Schema.NumberFromString),
});
