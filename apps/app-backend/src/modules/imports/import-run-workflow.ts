import { Workflow } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import { Effect, Layer, Schema } from "effect";

import { ImportRunJobData } from "./jobs";
import {
	OpenScaleImportItemSchema,
	loadOpenScaleAdapterResult,
	prepareOpenScaleWrites,
} from "./measurement/workflow";
import { isOneTimeMediaImportSource } from "./media/source-loaders";
import { MediaImportWorkflowOperationsLive } from "./media/workflow-operations";
import { failImportRun } from "./runtime/import-run-status";
import { ImportRunArtifacts, ImportRunError } from "./runtime/workflow-helpers";
import { runOneTimeMediaImportWorkflow } from "./workflows";
import {
	NonMediaImportWorkflowOperations,
	makeNonMediaImportOperationSet,
	runOneTimeNonMediaImportWorkflow,
} from "./workflows-non-media";
import { WorkoutImportItemSchema } from "./workout/domain";
import {
	loadHevyWorkoutAdapterResult,
	loadStrongAppWorkoutAdapterResult,
	prepareWorkoutWrites,
} from "./workout/workflow";

const NonMediaImportWorkflowOperationsLive = Layer.succeed(NonMediaImportWorkflowOperations, {
	getOperations: (payload) => {
		if (payload.source === "open_scale") {
			return Effect.succeed(
				makeNonMediaImportOperationSet({
					itemSchema: OpenScaleImportItemSchema,
					prepareWrites: prepareOpenScaleWrites,
					loadAdapterResult: loadOpenScaleAdapterResult,
				}),
			);
		}
		if (payload.source === "hevy") {
			return Effect.succeed(
				makeNonMediaImportOperationSet({
					itemSchema: WorkoutImportItemSchema,
					prepareWrites: prepareWorkoutWrites,
					loadAdapterResult: loadHevyWorkoutAdapterResult,
				}),
			);
		}
		if (payload.source === "strong_app") {
			return Effect.succeed(
				makeNonMediaImportOperationSet({
					itemSchema: WorkoutImportItemSchema,
					prepareWrites: prepareWorkoutWrites,
					loadAdapterResult: loadStrongAppWorkoutAdapterResult,
				}),
			);
		}
		return Effect.fail(
			new ImportRunError({ message: `Unsupported import source: ${payload.source}` }),
		);
	},
});

const runNonMediaImport = (payload: ImportRunJobData) => {
	if (payload.source === "open_scale") {
		return runOneTimeNonMediaImportWorkflow(payload);
	}
	if (payload.source === "hevy") {
		return runOneTimeNonMediaImportWorkflow(payload);
	}
	if (payload.source === "strong_app") {
		return runOneTimeNonMediaImportWorkflow(payload);
	}
	return failImportRun(payload.runId, `Unsupported import source: ${payload.source}`).pipe(
		Effect.mapError((error) => new ImportRunError({ message: unknownToMessage(error) })),
	);
};

export const ProcessImportRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: ImportRunError,
	payload: ImportRunJobData,
	name: "ProcessImportRunWorkflow",
	idempotencyKey: ({ runId }) => runId,
});

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer((payload, executionId) =>
	Effect.gen(function* () {
		if (!isOneTimeMediaImportSource(payload.source)) {
			yield* runNonMediaImport(payload);
			return;
		}

		yield* runOneTimeMediaImportWorkflow(payload, executionId);
	}),
);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportRunArtifacts.Default,
			MediaImportWorkflowOperationsLive,
			NonMediaImportWorkflowOperationsLive,
		),
	),
);
