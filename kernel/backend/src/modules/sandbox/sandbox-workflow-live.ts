import { Layer } from "effect";

import { implementLaneWorkflow } from "#lib/infrastructure/workflow-lane";

import { SandboxCompiledArtifacts } from "./compiled-artifacts";
import { SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	implementLaneWorkflow(SandboxScriptWorkflow, runSandboxScriptWorkflow),
	SandboxExecutionQueueWorkerLive.pipe(Layer.provideMerge(SandboxCompiledArtifacts.layer)),
);
