import { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";

import { ImportRunExecutionController } from "./execution-controller";
import { ImportsRepository } from "./repository";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

const CancelImportRunPayload = Schema.Struct({
	userId: UserId,
	runId: ImportRunId,
	accountGeneration: AccountGeneration,
});

export const CancelImportRunWorkflow = Workflow.make("CancelImportRunWorkflow", {
	success: Schema.Void satisfies DurableSchema,
	error: ImportRunError satisfies DurableSchema,
	idempotencyKey: ({ runId }) => `${runId}-cancellation`,
	payload: CancelImportRunPayload satisfies DurableSchema,
});

export const runCancelImportRunWorkflow = Effect.fn("CancelImportRunWorkflow")(function* (
	payload: typeof CancelImportRunPayload.Type,
) {
	const repository = yield* ImportsRepository;
	const controller = yield* ImportRunExecutionController;
	const control = yield* makeActivity({
		error: ImportRunError,
		name: "request-import-run-cancellation",
		success: Schema.NullOr(
			Schema.Struct({ executionKind: Schema.Literals(["source", "integration"]) }),
		),
		execute: Effect.gen(function* () {
			yield* repository.cancelIngestion(payload);
			const current = yield* repository.getIngestionRun(payload);
			return current?.status === "cancelling" ? { executionKind: current.executionKind } : null;
		}).pipe(Effect.mapError(toWorkflowError)),
	});
	if (!control) {
		return;
	}
	yield* controller.interrupt({ runId: payload.runId, executionKind: control.executionKind });
});

export const CancelImportRunWorkflowDefinitionsLive = implementWorkflow(
	CancelImportRunWorkflow,
	runCancelImportRunWorkflow,
);
