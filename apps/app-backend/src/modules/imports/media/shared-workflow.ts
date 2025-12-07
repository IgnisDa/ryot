import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { EntityId } from "@ryot/contract/schema/brands";
import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import type { ImportRunJobData } from "../jobs";
import { PROGRESS_UPDATE_INTERVAL } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { ImportsService } from "../service";

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
	fallbackToInitialCleanupPaths: Schema.Boolean,
	cleanupPaths: Schema.Array(Schema.String),
});

export const WriteOutcome = Schema.Struct({
	message: Schema.NullOr(Schema.String),
});

export type ProgressReporter = (
	processed: number,
) => Effect.Effect<void, ImportRunError, WorkflowEngine | WorkflowInstance | ImportsService>;

const calculateProgress = (input: {
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
	payload: Pick<ImportRunJobData, "runId">;
}): ProgressReporter => {
	let last = -1;

	return (processed: number) =>
		Effect.gen(function* () {
			const imports = yield* ImportsService;

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
				execute: imports
					.update({ progress, runId: input.payload.runId })
					.pipe(Effect.mapError(toWorkflowError)),
			});
		});
};

export type EntityIdsByKey = Map<string, EntityId>;
