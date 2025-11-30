import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Schema } from "effect";

import type { CurrentDb } from "#lib/db";
import type { EntityId } from "#lib/schema/brands";
import { EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";

import type { ImportRunJobData } from "../jobs";
import { PROGRESS_UPDATE_INTERVAL } from "../runtime/failures";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";

export const ResolutionCandidate = Schema.Struct({
	scriptSlug: Schema.String,
	sandboxScriptId: Schema.NullOr(SandboxScriptId),
});

export const PopulationScript = Schema.Struct({
	entitySchemaId: EntitySchemaId,
	sandboxScriptId: SandboxScriptId,
});

export const LoadMediaImportFailed = Schema.TaggedStruct("failed", {
	message: Schema.String,
	cleanupPaths: Schema.Array(Schema.String),
	fallbackToInitialCleanupPaths: Schema.Boolean,
});

export const EnsureLibraryMembershipOutcome = Schema.Struct({
	message: Schema.NullOr(Schema.String),
});

export type RunWithDb = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, Exclude<R, CurrentDb>>;

export type ProgressReporter = (
	processed: number,
) => Effect.Effect<void, ImportRunError, WorkflowEngine | WorkflowInstance>;

export const calculateProgress = (input: {
	base: number;
	span: number;
	groups: number;
	processed: number;
}) =>
	input.groups > 0
		? Math.min(
				input.base + Math.round((input.processed / input.groups) * input.span),
				input.base + input.span,
			)
		: input.base + input.span;

const isProgressUpdateDue = (processed: number, groups: number) =>
	processed % PROGRESS_UPDATE_INTERVAL === 0 || processed === groups;

export const activityKey = (value: string) =>
	Buffer.from(value, "utf8").toString("base64url") || "empty";

export const createProgressReporter = (input: {
	base: number;
	span: number;
	phase: string;
	groups: number;
	runWithDb: RunWithDb;
	payload: Pick<ImportRunJobData, "runId">;
	repository: {
		updateRun: (input: {
			progress: number;
			runId: ImportRunJobData["runId"];
		}) => Effect.Effect<unknown, unknown, CurrentDb>;
	};
}): ProgressReporter => {
	let last = -1;

	return (processed: number) =>
		Effect.gen(function* () {
			if (!isProgressUpdateDue(processed, input.groups)) {
				return;
			}

			const progress = calculateProgress({
				processed,
				base: input.base,
				span: input.span,
				groups: input.groups,
			});
			if (progress === last) {
				return;
			}

			last = progress;
			yield* Activity.make({
				error: ImportRunError,
				name: `report-progress-${input.phase}-${processed}`,
				execute: input
					.runWithDb(input.repository.updateRun({ progress, runId: input.payload.runId }))
					.pipe(Effect.mapError(toWorkflowError)),
			});
		});
};

export type EntityIdsByKey = Map<string, EntityId>;
