import { Effect, Layer } from "effect";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { runPluginImportWorkflow } from "./plugin-import-workflow";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

export const runProcessImportRunWorkflow = Effect.fn("ProcessImportRunWorkflow")(
	function* (payload: ImportRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
			sourceStateId: payload.sourceStateId,
		});
		yield* runPluginImportWorkflow(payload, executionId);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessImportRunWorkflow" }),
);

const ProcessImportRunWorkflowLive = implementWorkflow(
	ProcessImportRunWorkflow,
	runProcessImportRunWorkflow,
);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive.pipe(
	Layer.provide(ImportRunArtifacts.layer),
);
