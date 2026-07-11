import { Effect, Layer } from "effect";

import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import { MediaImportWorkflowOperationsLive } from "./media/operations-workflow";
import { isOneTimeMediaImportSource } from "./media/source-loaders";
import { NonMediaImportWorkflowOperationsLive } from "./non-media-operation-registry-workflow";
import { runOneTimeNonMediaImportWorkflow } from "./non-media-workflow";
import { runPluginImportWorkflow } from "./plugin-import-workflow";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

export const runProcessImportRunWorkflow = Effect.fn("ProcessImportRunWorkflow")(
	function* (payload: ImportRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
		});
		const registered = (yield* ImportSourceCatalog).find(payload.source);
		if (registered) {
			yield* runPluginImportWorkflow(payload, executionId, registered);
			return;
		}

		// TODO(plugin-system): Transitional: sources no plugin manifest declares still run the native media-versus-non-media
		// orchestration. Tasks 09 and 10 move all nineteen sources onto the dispatch path above and
		// delete this branch along with `isOneTimeMediaImportSource`.
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
