import { Activity } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { ImportSourceCatalog } from "#modules/plugins/import-source-catalog";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { runPluginImportWorkflow } from "./plugin-import-workflow";
import { failImportRun } from "./runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

export const runProcessImportRunWorkflow = Effect.fn("ProcessImportRunWorkflow")(
	function* (payload: ImportRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
		});
		const registered = (yield* ImportSourceCatalog).find(payload.source);
		if (!registered) {
			yield* Activity.make({
				error: ImportRunError,
				name: "fail-import-run",
				execute: failImportRun(payload.runId, "Import source is not registered").pipe(
					Effect.mapError(toWorkflowError),
				),
			});
			return;
		}
		yield* runPluginImportWorkflow(payload, executionId, registered);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessImportRunWorkflow" }),
);

const ProcessImportRunWorkflowLive = ProcessImportRunWorkflow.toLayer(runProcessImportRunWorkflow);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive.pipe(
	Layer.provide(ImportRunArtifacts.Default),
);
