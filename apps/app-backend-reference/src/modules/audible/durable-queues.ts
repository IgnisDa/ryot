import { DurableQueue } from "@effect/workflow";
import { Clock, Effect, Schema } from "effect";

import { SandboxRunError } from "../../lib/errors";
import { RedisService } from "../../lib/redis";
import { SandboxService } from "../../lib/sandbox";
import { SandboxRunResult } from "../sandbox/schemas";

export const AudibleSandboxQueuePayload = Schema.Struct({
	context: Schema.Unknown,
	runId: Schema.String,
	driverName: Schema.String,
	scriptSlug: Schema.String,
	executionId: Schema.String,
});

export const AudibleSandboxQueue = DurableQueue.make({
	name: "AudibleSandboxQueue",
	payload: AudibleSandboxQueuePayload,
	success: SandboxRunResult,
	error: SandboxRunError,
	idempotencyKey: ({ executionId }) => executionId,
});

export const AudibleNotifyQueuePayload = Schema.Struct({
	id: Schema.String,
	channel: Schema.String,
	message: Schema.String,
});

export const AudibleNotifyQueue = DurableQueue.make({
	name: "AudibleNotifyQueue",
	payload: AudibleNotifyQueuePayload,
	success: Schema.Number,
	error: Schema.Never,
	idempotencyKey: ({ id }) => id,
});

export const AudibleSandboxQueueWorkerLive = DurableQueue.worker(
	AudibleSandboxQueue,
	Effect.fn(function* (payload) {
		const sandbox = yield* SandboxService;
		const result = yield* sandbox
			.run({
				context: payload.context,
				runId: payload.runId,
				driverName: payload.driverName,
				scriptSlug: payload.scriptSlug,
				executionId: payload.executionId,
			})
			.pipe(Effect.mapError((error) => new SandboxRunError({ message: error.message })));
		if (!result.success) {
			return yield* new SandboxRunError({ message: result.error ?? "Sandbox run failed" });
		}

		const now = new Date(yield* Clock.currentTimeMillis).toISOString();
		return {
			id: payload.executionId,
			logs: result.logs,
			status: "completed" as const,
			result: result.value,
			error: null,
			runId: payload.runId,
			driverName: payload.driverName,
			scriptSlug: payload.scriptSlug,
			createdAt: now,
			updatedAt: now,
		};
	}),
	{ concurrency: 5 },
);

export const AudibleNotifyQueueWorkerLive = DurableQueue.worker(
	AudibleNotifyQueue,
	Effect.fn(function* (payload) {
		const redis = yield* RedisService;
		return yield* redis.publish(payload.channel, payload.message);
	}),
);
