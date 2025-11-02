import { DurableQueue } from "@effect/workflow";
import type { Result as WorkflowResult } from "@effect/workflow/Workflow";
import { Cause, Effect, Exit, Layer, Match, Option } from "effect";

import type { SandboxRunError } from "#lib/errors";
import { toSandboxRunError } from "#lib/errors";

import { SandboxExecutionQueue, SandboxExecutionQueueWorkerLive } from "./durable-queues";
import type {
	SandboxCompletedResult as SandboxCompletedResultValue,
	SandboxRunResult,
} from "./schemas";
import { RunSandboxWorkflow } from "./workflow-definitions";

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<SandboxRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Sandbox job failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
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
