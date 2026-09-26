import { Effect, Layer } from "effect";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";

import { runDataImportWorkflow } from "./data-workflow";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import type { ImportRunJobData } from "./jobs";
import { runPluginImportWorkflow } from "./plugin-import-workflow";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { toWorkflowError } from "./runtime/workflow-errors";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";

export const runProcessImportRunWorkflow = Effect.fn("ProcessImportRunWorkflow")(
	function* (payload: ImportRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
			sourceStateId: payload.sourceStateId,
		});
		if (payload.dataJson) {
			const receipts = yield* MutationReceipts.make;
			yield* admitWorkflow(
				receipts,
				ProcessImportRunWorkflow,
				payload.command.accountGeneration,
				executionId,
			).pipe(Effect.mapError(toWorkflowError));
			yield* runDataImportWorkflow(payload, executionId);
		} else {
			yield* runPluginImportWorkflow(payload, executionId);
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessImportRunWorkflow" }),
);

const ProcessImportRunWorkflowLive = implementWorkflow(
	ProcessImportRunWorkflow,
	runProcessImportRunWorkflow,
);

export const ImportWorkflowDefinitionsLive = ProcessImportRunWorkflowLive.pipe(
	Layer.provide(ImportRunArtifacts.layer.pipe(Layer.provideMerge(ImportSourceStateStore.layer))),
	Layer.provide(Layer.mergeAll(ImportsRepository.layer, DefinitionRepository.layer)),
);
