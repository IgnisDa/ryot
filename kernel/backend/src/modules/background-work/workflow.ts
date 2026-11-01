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
	const started = yield* makeActivity({
		name: "start",
		error: DbError,
		execute: service.start(id),
		success: Schema.NullOr(BackgroundWorkInput),
	});
	if (!started) {
		return undefined;
	}
	const projected = started.purpose !== "user-script";
	const result = yield* Effect.exit(
		Effect.gen(function* () {
			const job = projected
				? yield* makeActivity({
						error: DbError,
						name: "prepare-projection",
						execute: projection.prepare(started),
						success: Schema.NullOr(BackgroundWorkInput),
					})
				: started;
			if (!job) {
				return;
			}
			const output = yield* executor.execute(job);
			if (projected) {
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
				{ id, userId: started.accountGeneration.userId },
				result._tag === "Success" ? "succeeded" : "failed",
				result._tag === "Failure" ? unknownToMessage(result.cause) : null,
			)
			.pipe(Effect.asVoid),
	});
	yield* service
		.dispatch(id)
		.pipe(
			Effect.catchTag("DbError", (error) =>
				Effect.logWarning("Background handoff failed", error.message),
			),
		);
	return undefined;
});

export const BackgroundWorkWorkflowLive = implementWorkflow(
	BackgroundWorkWorkflow,
	runBackgroundWorkWorkflow,
).pipe(Layer.provide(BackgroundWorkService.layer));
