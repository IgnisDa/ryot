import type { SandboxRunError } from "@ryot/contract/errors";
import type {
	SandboxExecutionPayload,
	SandboxRunResult,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect, Layer } from "effect";
import type { Workflow } from "effect/unstable/workflow";

import { toWorkflowRunResult } from "#lib/shared/workflow-result";

import { processSandboxExecutionQueue, SandboxExecutionQueueWorkerLive } from "./durable-queues";
import type { SandboxExecutionResult } from "./execution-result";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";
import { SandboxSubmissionWorkflow } from "./sandbox-submission-workflow";

export const toSandboxRunResult = (
	result: Workflow.Result<SandboxExecutionResult, SandboxRunError> | undefined,
): SandboxRunResult =>
	toWorkflowRunResult(result, {
		failurePrefix: "Sandbox job failed: ",
		onSuccess: ({ harvest: _harvest, status: _status, ...value }) => value,
	});

const runSandboxSubmissionWorkflow = Effect.fn("SandboxSubmissionWorkflow")(
	function* (payload: SandboxExecutionPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		return yield* processSandboxExecutionQueue(payload);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "SandboxSubmissionWorkflow" }),
);

const SandboxSubmissionWorkflowLive = SandboxSubmissionWorkflow.toLayer(
	runSandboxSubmissionWorkflow,
);
const SandboxScriptWorkflowLive = SandboxScriptWorkflow.toLayer(runSandboxScriptWorkflow);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	SandboxSubmissionWorkflowLive,
	SandboxScriptWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
