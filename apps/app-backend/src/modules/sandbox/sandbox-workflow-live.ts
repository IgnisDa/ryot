import { Layer } from "effect";

import { SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";

const SandboxScriptWorkflowLive = SandboxScriptWorkflow.toLayer(runSandboxScriptWorkflow);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	SandboxScriptWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
