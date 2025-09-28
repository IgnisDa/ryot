import { Schema } from "effect";

export const AudibleRunStatus = Schema.Literal(
	"queued",
	"reading_upload",
	"processing",
	"awaiting_confirmation",
	"completed",
	"expired",
	"failed",
);

export type AudibleRunStatus = typeof AudibleRunStatus.Type;

export const AudibleItemStatus = Schema.Literal("matched", "not_found");

export type AudibleItemStatus = typeof AudibleItemStatus.Type;

export const WorkflowStep = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	status: Schema.String,
	details: Schema.NullOr(Schema.Unknown),
	createdAt: Schema.String,
});

export type WorkflowStep = typeof WorkflowStep.Type;

export const AudibleItem = Schema.Struct({
	id: Schema.String,
	asin: Schema.NullOr(Schema.String),
	query: Schema.String,
	title: Schema.NullOr(Schema.String),
	author: Schema.NullOr(Schema.String),
	status: AudibleItemStatus,
	details: Schema.NullOr(Schema.Unknown),
	imageUrl: Schema.NullOr(Schema.String),
	sourceUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
});

export type AudibleItem = typeof AudibleItem.Type;

export const AudibleRun = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	query: Schema.NullOr(Schema.String),
	status: AudibleRunStatus,
	uploadId: Schema.NullOr(Schema.String),
	executionId: Schema.NullOr(Schema.String),
	createdAt: Schema.String,
	updatedAt: Schema.String,
});

export type AudibleRun = typeof AudibleRun.Type;

export const AudibleRunResult = Schema.Struct({
	runId: Schema.String,
	matchedItems: Schema.Number,
	processedQueries: Schema.Number,
});

export type AudibleRunResult = typeof AudibleRunResult.Type;

export const AudibleImportConfirmation = Schema.Struct({
	userId: Schema.String,
	confirmedAt: Schema.String,
});

export type AudibleImportConfirmation = typeof AudibleImportConfirmation.Type;

export const AudibleImportItem = Schema.Struct({
	asin: Schema.NullOr(Schema.String),
	query: Schema.String,
	title: Schema.NullOr(Schema.String),
	author: Schema.NullOr(Schema.String),
	status: AudibleItemStatus,
	details: Schema.Unknown,
	imageUrl: Schema.NullOr(Schema.String),
	sourceUrl: Schema.NullOr(Schema.String),
});

export type AudibleImportItem = typeof AudibleImportItem.Type;

export const AudibleRunDetail = Schema.Struct({
	run: AudibleRun,
	items: Schema.Array(AudibleItem),
	steps: Schema.Array(WorkflowStep),
	finalResult: Schema.NullOr(AudibleRunResult),
	workflowPoll: Schema.NullOr(Schema.String),
});

export type AudibleRunDetail = typeof AudibleRunDetail.Type;

export const CreateAudibleRunPayload = Schema.Struct({
	query: Schema.optional(Schema.String),
	uploadId: Schema.optional(Schema.String),
});

export type CreateAudibleRunPayload = typeof CreateAudibleRunPayload.Type;

export const AudibleSearchItem = Schema.Struct({
	author: Schema.NullOr(Schema.String),
	title: Schema.String,
	imageUrl: Schema.NullOr(Schema.String),
	externalId: Schema.String,
});

export type AudibleSearchItem = typeof AudibleSearchItem.Type;

export const AudibleSearchResult = Schema.Struct({
	items: Schema.Array(AudibleSearchItem),
});

export type AudibleSearchResult = typeof AudibleSearchResult.Type;

export const AudibleDetailsResult = Schema.Struct({
	asin: Schema.String,
	author: Schema.NullOr(Schema.String),
	title: Schema.String,
	narrators: Schema.Array(Schema.String),
	imageUrl: Schema.NullOr(Schema.String),
	sourceUrl: Schema.NullOr(Schema.String),
	description: Schema.NullOr(Schema.String),
});

export type AudibleDetailsResult = typeof AudibleDetailsResult.Type;
