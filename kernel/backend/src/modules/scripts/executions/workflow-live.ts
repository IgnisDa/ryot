import { Layer } from "effect";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { ExecutableArtifacts } from "../registry/executable-artifacts";
import { SandboxExecutionQueueWorkerLive } from "./queues";
import { runScriptExecutionWorkflow, ScriptExecutionWorkflow } from "./workflow";

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	implementWorkflow(ScriptExecutionWorkflow, runScriptExecutionWorkflow),
	SandboxExecutionQueueWorkerLive.pipe(Layer.provideMerge(ExecutableArtifacts.layer)),
);
