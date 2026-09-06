import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { ImportRunExecutionController } from "#modules/imports/execution-controller";
import { ProcessImportRunWorkflow } from "#modules/imports/import-run-workflow";
import { toWorkflowError } from "#modules/imports/runtime/workflow-errors";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";

export const ImportRunExecutionControllerLive = Layer.effect(
	ImportRunExecutionController,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		return {
			interrupt: ({ runId, executionKind }) =>
				executionKind === "source"
					? engine.interrupt(ProcessImportRunWorkflow, runId).pipe(Effect.mapError(toWorkflowError))
					: engine
							.interrupt(ProcessIntegrationRunWorkflow, runId)
							.pipe(Effect.mapError(toWorkflowError)),
		};
	}),
);
