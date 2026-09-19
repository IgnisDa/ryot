import { Layer } from "effect";

import { implementLaneWorkflow } from "#lib/infrastructure/workflow-lane";

import { SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	implementLaneWorkflow(SandboxScriptWorkflow, runSandboxScriptWorkflow),
	SandboxExecutionQueueWorkerLive,
);
