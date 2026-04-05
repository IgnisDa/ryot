import { DurableQueue } from "@effect/workflow";
import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import type {
	SandboxCompletedResult as SandboxCompletedResultValue,
	SandboxExecutionPayload,
	SandboxRunResult,
} from "@ryot/contract/modules/sandbox/schemas";
import { Cause, Effect, Exit, Layer, Match, Option } from "effect";

import { SandboxExecutionQueue, SandboxExecutionQueueWorkerLive } from "./durable-queues";
import { RunSandboxWorkflow } from "./sandbox-run-workflow";

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<SandboxRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onSome: (error) => ({ status: "failed", error: error.message }),
		onNone: () => ({
			status: "failed",
			error: `Sandbox job failed: ${Cause.pretty(cause).slice(0, 500)}`,
		}),
	});

export const toSandboxRunResult = (
	result: WorkflowResult<SandboxCompletedResultValue, SandboxRunError> | undefined,
): SandboxRunResult => {
	if (!result) {
		return { status: "pending" };
	}

	return Match.value(result).pipe(
		Match.tag("Suspended", () => ({ status: "pending" as const })),
		Match.orElse(({ exit }) =>
			Exit.match(exit, {
				onFailure: workflowFailureResult,
				onSuccess: (value) => value,
			}),
		),
	);
};

const runSandboxWorkflow = Effect.fn("RunSandboxWorkflow")(
	function* (payload: SandboxExecutionPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({ executionId });
		const executionPayload: SandboxExecutionPayload = {
			context: payload.context,
			scriptId: payload.scriptId,
			authority: payload.authority,
			executionId: payload.executionId,
		};
		return yield* DurableQueue.process(SandboxExecutionQueue, executionPayload).pipe(
			Effect.mapError(toSandboxRunError),
		);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "RunSandboxWorkflow" }),
);

const RunSandboxWorkflowLive = RunSandboxWorkflow.toLayer(runSandboxWorkflow);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	RunSandboxWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
