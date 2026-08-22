import { Effect, Schema } from "effect";

import { writeArtifact } from "../artifacts";
import { CheckpointSeriesSummary } from "./checkpoints";
import { CpuProfileSummary } from "./cpu-profile";
import { HeapSnapshotSummary } from "./heap-snapshot";
import { findSensitiveStrings, UnsanitizedSummaryError } from "./sanitize";

const Label = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)),
);

export const ProfileKind = Schema.Literals([
	"deno-cpu",
	"deno-heap",
	"bun-cpu",
	"bun-heap",
	"bun-gc",
]);
export type ProfileKind = typeof ProfileKind.Type;

/** A heap snapshot is labelled by the checkpoint record that referenced its file, if any. */
export const LabelledHeapSummary = Schema.Struct({
	summary: HeapSnapshotSummary,
	phase: Schema.NullOr(Schema.String),
	sequence: Schema.NullOr(Schema.Int),
	checkpoint: Schema.NullOr(Schema.String),
});
export type LabelledHeapSummary = typeof LabelledHeapSummary.Type;

export const ProfileEntry = Schema.Struct({
	workload: Label,
	profileId: Label,
	kind: ProfileKind,
	/** Null for the entry that aggregates every attempt of one logical execution. */
	attempt: Schema.NullOr(Schema.Int),
	notes: Schema.Array(Schema.String),
	cpu: Schema.optional(CpuProfileSummary),
	checkpoints: Schema.optional(CheckpointSeriesSummary),
	heaps: Schema.optional(Schema.Array(LabelledHeapSummary)),
});
export type ProfileEntry = typeof ProfileEntry.Type;

export const RawDeletionStatus = Schema.Struct({
	deleted: Schema.Boolean,
	remainingEntries: Schema.Int,
	verifiedAtUtc: Schema.String,
});

export const ProfilesSummary = Schema.Struct({
	runId: Label,
	generatedAtUtc: Schema.String,
	rawDeletion: RawDeletionStatus,
	profiles: Schema.Array(ProfileEntry),
});
export type ProfilesSummary = typeof ProfilesSummary.Type;

/** The sanitizer runs before encoding so a summary that could leak never reaches the disk. */
export const writeProfilesSummary = (path: string, summary: ProfilesSummary) =>
	Effect.sync(() => findSensitiveStrings(summary)).pipe(
		Effect.flatMap((findings) =>
			findings.length === 0 ? Effect.void : Effect.fail(new UnsanitizedSummaryError(findings)),
		),
		Effect.andThen(writeArtifact(ProfilesSummary, path, summary)),
	);
