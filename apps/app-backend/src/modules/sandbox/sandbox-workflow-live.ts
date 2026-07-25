import type { SandboxRunError } from "@ryot/contract/errors";
import type {
	SandboxExecutionPayload,
	SandboxRunResult,
} from "@ryot/contract/modules/sandbox/schemas";
import { Cause, Effect, Exit, Layer, Match, Option } from "effect";
import type { Workflow } from "effect/unstable/workflow";

import { processSandboxExecutionQueue, SandboxExecutionQueueWorkerLive } from "./durable-queues";
import type { SandboxExecutionResult } from "./execution-result";
import { runSandboxScriptWorkflow, SandboxScriptWorkflow } from "./sandbox-script-workflow";
import { SandboxSubmissionWorkflow } from "./sandbox-submission-workflow";

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<SandboxRunResult, { status: "failed" }> =>
	Option.match(Cause.findErrorOption(cause), {
		onSome: (error) => ({ status: "failed", error: error.message }),
		onNone: () => ({
			status: "failed",
			error: `Sandbox job failed: ${Cause.pretty(cause).slice(0, 500)}`,
		}),
	});

export const toSandboxRunResult = (
	result: Workflow.Result<SandboxExecutionResult, SandboxRunError> | undefined,
): SandboxRunResult => {
	if (!result) {
		return { status: "pending" };
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => ({ status: "pending" as const })),
		Match.orElse(({ exit }) =>
			Exit.match(exit, {
				onFailure: workflowFailureResult,
				onSuccess: ({ harvest: _harvest, ...value }) => value,
			}),
		),
	);
};

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
