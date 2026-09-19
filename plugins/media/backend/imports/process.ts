import {
	genericImportWorkflowResultSchema,
	ingestionArtifactsSchema,
	LifecycleCommand,
} from "@ryot-app/sandbox-sdk/imports";
import { Schema } from "@ryot-app/sandbox-sdk/workflow";

import { MediaSortedRun, MediaSourceInput } from "./collection-schemas";
import { MediaImportAdapterBatch, MediaIntegrationAdapterResult } from "./schemas";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const MediaReadBatchInput = Schema.Struct({
	offset: count,
	itemIndex: count,
	dedupKey: Schema.NullOr(Schema.String),
	ingestionArtifacts: ingestionArtifactsSchema,
});
const readFields = {
	offset: count,
	itemIndex: count,
	done: Schema.Boolean,
	batch: MediaImportAdapterBatch,
	dedupKey: Schema.NullOr(Schema.String),
};
export const MediaReadBatchOutput = Schema.Struct({
	...readFields,
	chunkFiles: Schema.Array(Schema.String),
});
export const MediaReadBatchResult = Schema.Struct({
	...readFields,
	chunkHandles: Schema.Array(Schema.String),
});
export const MediaIntegrationArtifactResult = Schema.Struct({
	chunkHandles: Schema.Array(Schema.String),
	advancedAt: Schema.optional(Schema.String),
	carryFile: Schema.optional(Schema.NullOr(Schema.String)),
	sourceFailure: MediaIntegrationAdapterResult.fields.sourceFailure,
});
export const MediaIntegrationCollectionInput = Schema.Struct({
	page: count,
	ordinal: count,
	runId: Schema.String,
	command: LifecycleCommand,
	integrationContext: Schema.Unknown,
	carry: Schema.NullOr(Schema.String),
	integrationScriptSlug: Schema.String,
});
export const MediaIntegrationCollectionOutput = Schema.Struct({
	page: count,
	ordinal: count,
	done: Schema.Boolean,
	run: Schema.NullOr(MediaSortedRun),
	carry: Schema.NullOr(Schema.String),
	sourceFailure: MediaIntegrationAdapterResult.fields.sourceFailure,
});
export const MediaMergeInput = Schema.Struct({
	page: count,
	ordinal: count,
	leftPage: count,
	rightPage: count,
	leftOffset: count,
	rightOffset: count,
	left: MediaSortedRun,
	runId: Schema.String,
	right: MediaSortedRun,
	prefix: Schema.String,
	command: LifecycleCommand,
});
export const MediaMergeOutput = Schema.Struct({
	page: count,
	ordinal: count,
	leftPage: count,
	rightPage: count,
	leftOffset: count,
	rightOffset: count,
	done: Schema.Boolean,
});
export const MediaApplicationInput = Schema.Struct({
	page: count,
	batch: count,
	offset: count,
	ordinal: count,
	itemIndex: count,
	issueLimit: count,
	run: MediaSortedRun,
	runId: Schema.String,
	command: LifecycleCommand,
	integrationContext: Schema.Unknown,
	dedupKey: Schema.NullOr(Schema.String),
	integrationScriptSlug: Schema.NullOr(Schema.String),
});
export const MediaApplicationOutput = Schema.Struct({
	page: count,
	batch: count,
	offset: count,
	ordinal: count,
	itemIndex: count,
	done: Schema.Boolean,
	dedupKey: Schema.NullOr(Schema.String),
	issues: genericImportWorkflowResultSchema.fields.issues,
});
export const MediaCollectionInput = Schema.Struct({
	...MediaSourceInput.fields,
	step: count,
	ordinal: count,
	runId: Schema.String,
	source: Schema.String,
	prefix: Schema.String,
	command: LifecycleCommand,
	carry: Schema.NullOr(Schema.String),
	records: Schema.NullOr(Schema.String),
});
export const MediaCollectionOutput = Schema.Struct({
	step: count,
	offset: count,
	ordinal: count,
	itemIndex: count,
	eventOffset: count,
	done: Schema.Boolean,
	header: Schema.String,
	advancedAt: Schema.String,
	run: Schema.NullOr(MediaSortedRun),
	carry: Schema.NullOr(Schema.String),
});
