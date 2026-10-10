import { Layer } from "effect";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import { SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	implementWorkflow(SandboxScriptWorkflow, runSandboxScriptWorkflow),
	SandboxExecutionQueueWorkerLive.pipe(Layer.provideMerge(SandboxCompiledArtifacts.layer)),
);
