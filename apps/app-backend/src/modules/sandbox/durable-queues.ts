import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { DbRunner } from "~/lib/db";
import { SandboxRunError, unknownToMessage } from "~/lib/errors";
import { SandboxService as RuntimeSandboxService } from "~/lib/sandbox";

import { SandboxRepository } from "./repository";
import { SandboxCompletedResult, SandboxExecutionPayload } from "./schemas";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

export const SandboxExecutionQueueWorkerLive = DurableQueue.worker(
	SandboxExecutionQueue,
	(payload) =>
		Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* SandboxRepository;
			const sandbox = yield* RuntimeSandboxService;

			const script = yield* runWithDb(
				repository.getScriptForUser({ userId: payload.userId, scriptId: payload.scriptId }),
			);
			if (!script) {
				return yield* new SandboxRunError({ message: "Sandbox script not found" });
			}

			const result = yield* sandbox.run({
				code: script.code,
				scriptId: script.id,
				userId: payload.userId,
				context: payload.context,
				driverName: payload.driverName,
				executionId: payload.executionId,
				allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
			});

			return {
				logs: result.logs,
				error: result.error,
				value: result.value,
				timing: result.timing,
				status: "completed" as const,
			};
		}).pipe(Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) }))),
	{ concurrency: 5 },
);
