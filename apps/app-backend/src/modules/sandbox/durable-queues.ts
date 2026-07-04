import { DurableQueue } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";

import { SandboxRepository } from "./repository";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const makeSandboxExecutionQueueWorkerLive = (concurrency: number) =>
	DurableQueue.worker(
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
					scriptId: script.id,
					userId: payload.userId,
					context: payload.context,
					metadata: script.metadata,
					driverName: payload.driverName,
					executionId: payload.executionId,
					scriptIsBuiltin: script.isBuiltin,
					compiledCode: script.compiledCode,
					compiledFormat: script.compiledFormat,
					allowedHostFunctions: script.metadata.capabilities ?? [],
					...(payload.subscriptionRun ? { subscriptionRun: payload.subscriptionRun } : {}),
				});

				return {
					logs: result.logs,
					error: result.error,
					value: result.value,
					timing: result.timing,
					status: "completed" as const,
				};
			}).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
				Effect.withSpan("SandboxExecutionQueue", {
					attributes: {
						userId: payload.userId,
						scriptId: payload.scriptId,
						executionId: payload.executionId,
					},
				}),
			),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
