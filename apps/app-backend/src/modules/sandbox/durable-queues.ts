import { DurableQueue } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import { SandboxRunError, unknownToMessage } from "#lib/errors";
import { SandboxService as RuntimeSandboxService } from "#lib/sandbox/service";

import { SandboxRepository } from "./repository";
import { SandboxCompletedResult, SandboxExecutionPayload } from "./schemas";

export const SandboxExecutionQueue = DurableQueue.make({
	error: SandboxRunError,
	name: "SandboxExecutionQueue",
	success: SandboxCompletedResult,
	payload: SandboxExecutionPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

// Scripts cannot read their own stored metadata, so the host injects the
// provider's declared canonical language as the driver's `language` input. A
// caller that already supplies a `language` (e.g. the translate driver, which
// passes the target language) takes precedence.
const withCanonicalLanguage = (
	context: unknown,
	canonicalLanguage: string | undefined,
): unknown => {
	if (
		canonicalLanguage === undefined ||
		typeof context !== "object" ||
		context === null ||
		Array.isArray(context) ||
		"language" in context
	) {
		return context;
	}

	return { ...context, language: canonicalLanguage };
};

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
					code: script.code,
					scriptId: script.id,
					userId: payload.userId,
					driverName: payload.driverName,
					executionId: payload.executionId,
					scriptIsBuiltin: script.isBuiltin,
					allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
					context: withCanonicalLanguage(
						payload.context,
						script.metadata.providerInformation?.canonicalLanguage,
					),
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
			),
		{ concurrency },
	);

export const SandboxExecutionQueueWorkerLive = Layer.unwrapEffect(
	Effect.map(AppConfig, (config) =>
		makeSandboxExecutionQueueWorkerLive(config.sandbox.workerConcurrency),
	),
);
