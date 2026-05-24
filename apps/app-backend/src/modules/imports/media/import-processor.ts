import { Schema } from "effect";

import { ImportRunFailureStage } from "../schemas";
import { ImportMediaEntityGroupSchema } from "./types";

export const MediaImportAdapterFailureSchema = Schema.Struct({
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
