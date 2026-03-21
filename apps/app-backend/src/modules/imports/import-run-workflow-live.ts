import { Effect, Layer } from "effect";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import { MediaImportWorkflowOperationsLive } from "./media/operations-workflow";
import { isOneTimeMediaImportSource } from "./media/source-loaders";
import { NonMediaImportWorkflowOperationsLive } from "./non-media-operation-registry-workflow";
import { runOneTimeNonMediaImportWorkflow } from "./non-media-workflow";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer((payload, executionId) =>
	Effect.gen(function* () {
		if (!isOneTimeMediaImportSource(payload.source)) {
			yield* runOneTimeNonMediaImportWorkflow(payload);
			return;
		}

		yield* runOneTimeMediaImportWorkflow(payload, executionId);
	}).pipe(
		Effect.withSpan("ProcessImportRunWorkflow", {
			attributes: { runId: payload.runId, userId: payload.userId, executionId },
		}),
		Effect.annotateLogs({ executionId, workflow: "ProcessImportRunWorkflow" }),
	),
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
