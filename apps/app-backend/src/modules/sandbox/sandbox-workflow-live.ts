import { DurableQueue } from "@effect/workflow";
import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import type { SandboxRunError } from "@ryot/contract/errors";
import { toSandboxRunError } from "@ryot/contract/errors";
import type {
	SandboxCompletedResult as SandboxCompletedResultValue,
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

const RunSandboxWorkflowLive = RunSandboxWorkflow.toLayer((payload) =>
	DurableQueue.process(SandboxExecutionQueue, payload).pipe(Effect.mapError(toSandboxRunError)),
);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	RunSandboxWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
