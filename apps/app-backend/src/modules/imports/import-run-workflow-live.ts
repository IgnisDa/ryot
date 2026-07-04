import { Effect, Layer } from "effect";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import { MediaImportWorkflowOperationsLive } from "./media/operations-workflow";
import { isOneTimeMediaImportSource } from "./media/source-loaders";
import { NonMediaImportWorkflowOperationsLive } from "./non-media-operation-registry-workflow";
import { runOneTimeNonMediaImportWorkflow } from "./non-media-workflow";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

const runProcessImportRunWorkflow = Effect.fn("ProcessImportRunWorkflow")(
	function* (payload: ImportRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
		});
		if (!isOneTimeMediaImportSource(payload.source)) {
			yield* runOneTimeNonMediaImportWorkflow(payload);
			return;
		}

		yield* runOneTimeMediaImportWorkflow(payload, executionId);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessImportRunWorkflow" }),
);

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer(runProcessImportRunWorkflow);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			ImportRunArtifacts.Default,
			MediaImportWorkflowOperationsLive,
			NonMediaImportWorkflowOperationsLive,
		),
	),
);
