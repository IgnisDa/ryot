import { Workflow } from "@effect/workflow";
import { Effect, Layer, Schema } from "effect";

import { ImportRunJobData } from "./jobs";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import { MediaImportWorkflowOperationsLive } from "./media/operations-workflow";
import { isOneTimeMediaImportSource } from "./media/source-loaders";
import { NonMediaImportWorkflowOperationsLive } from "./non-media-operation-registry-workflow";
import { runOneTimeNonMediaImportWorkflow } from "./non-media-workflow";
import { ImportRunArtifacts, ImportRunError } from "./runtime/workflow-helpers";

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
			yield* runOneTimeNonMediaImportWorkflow(payload);
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
