import { DurableQueue, type Workflow } from "@effect/workflow";
import { Cause, Effect, Exit, Layer, Match, Option } from "effect";

import { SandboxRunError, unknownToMessage } from "#lib/errors";

import { SandboxExecutionQueue, SandboxExecutionQueueWorkerLive } from "./durable-queues";
import type {
	SandboxCompletedResult as SandboxCompletedResultValue,
	SandboxRunResult,
} from "./schemas";
import { RunSandboxWorkflow } from "./workflow-definitions";

const toWorkflowError = (cause: unknown) =>
	cause instanceof SandboxRunError
		? cause
		: new SandboxRunError({ message: unknownToMessage(cause) });

const workflowFailureResult = (
	cause: Cause.Cause<SandboxRunError>,
): Extract<SandboxRunResult, { status: "failed" }> =>
	Option.match(Cause.failureOption(cause), {
		onNone: () => ({ status: "failed", error: "Sandbox job failed" }),
		onSome: (error) => ({ status: "failed", error: error.message }),
	});

export const toSandboxRunResult = (
	result: Workflow.Result<SandboxCompletedResultValue, SandboxRunError> | undefined,
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
	DurableQueue.process(SandboxExecutionQueue, payload).pipe(Effect.mapError(toWorkflowError)),
);

export const SandboxWorkflowDefinitionsLive = Layer.mergeAll(
	RunSandboxWorkflowLive,
	SandboxExecutionQueueWorkerLive,
);
