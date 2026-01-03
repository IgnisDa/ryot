import { ImportRunFailureStage } from "@ryot/contract/modules/imports/schemas";
import { Schema } from "effect";

import { ImportMediaEntityGroupSchema } from "./types";

const MediaImportAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.optional(Schema.String),
	stage: Schema.optional(ImportRunFailureStage),
	sourceIdentifier: Schema.optional(Schema.String),
	context: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export type MediaImportAdapterFailure = typeof MediaImportAdapterFailureSchema.Type;

export const MediaImportAdapterResultSchema = Schema.Struct({
	failures: Schema.Array(MediaImportAdapterFailureSchema),
	entityGroups: Schema.Array(ImportMediaEntityGroupSchema),
});

export type MediaImportAdapterResult = typeof MediaImportAdapterResultSchema.Type;

// A compact projection of an adapter result: the entity group count plus the row-level
// failures. Parents journal this summary while the bulk (entity groups) lives only in the
// Redis artifact the normalized-import child rehydrates.
export const MediaImportAdapterSummarySchema = Schema.Struct({
	groups: Schema.Number,
	failures: Schema.Array(MediaImportAdapterFailureSchema),
});

export type MediaImportAdapterSummary = typeof MediaImportAdapterSummarySchema.Type;

export const toMediaImportAdapterSummary = (
	result: MediaImportAdapterResult,
): MediaImportAdapterSummary => ({
	failures: result.failures,
	groups: result.entityGroups.length,
});
