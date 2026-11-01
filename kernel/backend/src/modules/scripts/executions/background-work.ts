import { DbError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { BackgroundWorkExecutor } from "#modules/background-work/model";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { ScriptExecutionWorkflow } from "./workflow";

export const BackgroundWorkExecutorLive = Layer.effect(
	BackgroundWorkExecutor,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		return {
			execute: (job) =>
				dispatchAdmittedWorkflow(engine, ScriptExecutionWorkflow, job.accountGeneration, {
					payload: job.execution,
					executionId: job.execution.executionId,
				}).pipe(Effect.mapError((error) => new DbError({ message: error.message }))),
		};
	}),
);
