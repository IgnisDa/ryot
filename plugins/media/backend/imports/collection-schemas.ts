import { zipEntrySchema } from "@ryot-app/sandbox-sdk/fflate";
import { sandboxScratchManifestSchema } from "@ryot-app/sandbox-sdk/filesystem";
import { ingestionArtifactsSchema } from "@ryot-app/sandbox-sdk/imports";
import { Schema } from "@ryot-app/sandbox-sdk/workflow";

import { MediaImportBatchEntityGroup, MediaImportFailure } from "./schemas";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const MediaSourceInput = Schema.Struct({
	offset: count,
	itemIndex: count,
	fileIndex: count,
	header: Schema.String,
	importedAt: Schema.String,
	leftOffset: Schema.optional(count),
	eventOffset: Schema.optional(count),
	rightOffset: Schema.optional(count),
	entry: Schema.optional(zipEntrySchema),
	leftFinal: Schema.optional(Schema.Boolean),
	rightFinal: Schema.optional(Schema.Boolean),
	settings: Schema.Record(Schema.String, Schema.Unknown),
	action: Schema.Literals(["collect", "merge", "normalize"]),
	ingestionArtifacts: Schema.optional(ingestionArtifactsSchema),
});
export type MediaSourceInput = typeof MediaSourceInput.Type;
const sourceOutputFields = {
	offset: count,
	itemIndex: count,
	fileIndex: count,
	leftOffset: count,
	eventOffset: count,
	rightOffset: count,
	done: Schema.Boolean,
	header: Schema.String,
	leftDone: Schema.Boolean,
	advancedAt: Schema.String,
	rightDone: Schema.Boolean,
	carryFile: Schema.NullOr(Schema.String),
};
export const MediaSourceOutput = Schema.Struct({
	...sandboxScratchManifestSchema.fields,
	...sourceOutputFields,
});
export const MediaSourceResult = Schema.Struct({
	chunkHandles: Schema.Array(Schema.String),
	...sourceOutputFields,
});
export const MediaSortedRun = Schema.Struct({ pages: count, prefix: Schema.String });
export type MediaSortedRun = typeof MediaSortedRun.Type;
const mediaSourceRecordFields = {
	itemIndex: count,
	eventIndex: count,
	key: Schema.String,
	dedupKey: Schema.optional(Schema.String),
	failure: Schema.optional(MediaImportFailure),
	group: Schema.optional(MediaImportBatchEntityGroup),
};
export const MediaRawSourceRecord = Schema.Struct({
	...mediaSourceRecordFields,
	raw: Schema.Unknown,
	section: Schema.optional(Schema.String),
});
export const MediaNormalizedSourceRecord = Schema.Struct({
	...mediaSourceRecordFields,
	operationId: Schema.NonEmptyString,
	failure: Schema.optional(MediaImportFailure),
	group: Schema.optional(MediaImportBatchEntityGroup),
}).check(
	Schema.makeFilter((record) => {
		const group = record.group;
		if (!group) {
			return true;
		}
		const encoder = new TextEncoder();
		const size = (value: string | null) => (value === null ? 0 : encoder.encode(value).length);
		return (
			(group.events.length <= 1 &&
				group.collectionMemberships.length <= 1 &&
				group.events.every(
					(event) =>
						!event.attribution ||
						(size(event.attribution.recordId) <= 1024 &&
							size(event.attribution.sourceLabel) <= 8192 &&
							size(event.attribution.sourceIdentifier) <= 2048),
				)) ||
			"Media source atoms and event attribution must be bounded"
		);
	}),
);
export const MediaSourceRecord = Schema.Union([MediaRawSourceRecord, MediaNormalizedSourceRecord]);
export type MediaSourceRecord = typeof MediaSourceRecord.Type;
export type MediaRawSourceRecord = typeof MediaRawSourceRecord.Type;
export type MediaNormalizedSourceRecord = typeof MediaNormalizedSourceRecord.Type;
