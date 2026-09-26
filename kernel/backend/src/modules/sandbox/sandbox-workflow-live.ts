import { Layer } from "effect";

import { implementWorkflow } from "#lib/infrastructure/workflow-scope";

import { SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";

const SandboxScriptWorkflowLive = implementWorkflow(
	SandboxScriptWorkflow,
	runSandboxScriptWorkflow,
);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	SandboxScriptWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
