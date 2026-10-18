import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import { Cause, Effect, Layer, Schema } from "effect";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import {
	BackgroundWorkExecutor,
	BackgroundWorkInput,
	BackgroundWorkProjectionFinalizer,
} from "./model";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "./service";

export const runBackgroundWorkWorkflow = Effect.fn("BackgroundWorkWorkflow")(function* ({
	id,
}: typeof BackgroundWorkWorkflow.payloadSchema.Type) {
	const service = yield* BackgroundWorkService;
	const executor = yield* BackgroundWorkExecutor;
	const projection = yield* BackgroundWorkProjectionFinalizer;
	const job = yield* makeActivity({
		name: "start",
		error: DbError,
		execute: service.start(id),
		success: Schema.NullOr(BackgroundWorkInput),
	});
	if (!job) {
		return undefined;
	}
	const result = yield* Effect.exit(
		Effect.gen(function* () {
			const output = yield* executor.execute(job);
			if (job.purpose === "event-projection") {
				yield* projection.publish(job, output);
			}
		}),
	);
	if (result._tag === "Failure") {
		const instance = yield* WorkflowInstance;
		if (instance.suspended && Cause.hasInterruptsOnly(result.cause)) {
			return yield* Effect.interrupt;
		}
	}
	yield* makeActivity({
		name: "finish",
		error: DbError,
		success: Schema.Void,
		execute: service
			.finish(
				id,
				result._tag === "Success" ? "succeeded" : "failed",
				result._tag === "Failure" ? unknownToMessage(result.cause) : null,
			)
			.pipe(Effect.asVoid),
	});
	if (result._tag === "Failure" && job.purpose === "event-projection") {
		yield* projection.failed(job);
	}
	yield* service.recover();
	return undefined;
});

export const BackgroundWorkWorkflowLive = implementWorkflow(
	BackgroundWorkWorkflow,
	runBackgroundWorkWorkflow,
).pipe(Layer.provide(BackgroundWorkService.layer));
