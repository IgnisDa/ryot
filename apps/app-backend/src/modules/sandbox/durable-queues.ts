import { DurableQueue } from "@effect/workflow";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import {
	boundSandboxError,
	boundSandboxLogs,
	boundProviderSandboxValue,
	boundSandboxValue,
} from "#lib/infrastructure/sandbox-runtime/serialization-bounds";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";

import { SandboxRepository } from "./repository";

const baseCapabilities = [
	"httpCall",
	"getEntity",
	"listEvents",
	"setCachedValue",
	"getCachedValue",
	"getIntegration",
	"getEntitySchema",
	"claimCachedValue",
	"listEventSchemas",
	"listIntegrations",
	"getAppConfigValue",
	"executeQueryEngine",
	"getUserPreferences",
] as const;

const baseCapabilityCeiling = new Set(baseCapabilities);
const kindCapabilityCeilings = {
	policy: baseCapabilityCeiling,
	provider: baseCapabilityCeiling,
	direct: new Set([...baseCapabilities, "createEvents"]),
	subscription: new Set([...baseCapabilities, "createEvents", "emitSignal", "sendNotification"]),
} as const;

export const resolveEffectiveHostFunctions = (input: {
	scriptAllowlist: ReadonlyArray<string>;
	executionKind: keyof typeof kindCapabilityCeilings;
	capabilityCeiling?: ReadonlyArray<string> | undefined;
}) => {
	const kindCeiling: ReadonlySet<string> = kindCapabilityCeilings[input.executionKind];
	const runCeiling = input.capabilityCeiling ? new Set(input.capabilityCeiling) : null;
	return input.scriptAllowlist.filter(
		(name) => kindCeiling.has(name) && (runCeiling === null || runCeiling.has(name)),
	);
};

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
					code: script.code,
					scriptId: script.id,
					userId: payload.userId,
					context: payload.context,
					metadata: script.metadata,
					driverName: payload.driverName,
					executionId: payload.executionId,
					scriptIsBuiltin: script.isBuiltin,
					executionKind: payload.executionKind,
					automationRun: payload.automationRun,
					allowedHostFunctions: resolveEffectiveHostFunctions({
						executionKind: payload.executionKind,
						capabilityCeiling: payload.capabilityCeiling,
						scriptAllowlist: script.metadata.allowedHostFunctions ?? [],
					}),
				});
				const scriptHash = new Bun.CryptoHasher("sha256")
					.update(stableStringify({ code: script.code, metadata: script.metadata }))
					.digest("base64url");
				const boundedValue =
					payload.executionKind === "provider"
						? boundProviderSandboxValue(result.value)
						: boundSandboxValue(result.value);
				let value: unknown = null;
				if (boundedValue.kind === "accepted") {
					value =
						payload.executionKind === "provider"
							? { kind: "provider_value", value: boundedValue.value }
							: boundedValue.value;
				} else if (boundedValue.kind === "artifact") {
					const artifactId = `provider-${new Bun.CryptoHasher("sha256")
						.update(payload.executionId)
						.digest("base64url")}`;
					yield* runWithDb(
						repository.storeProviderArtifact({
							id: artifactId,
							value: result.value,
							executionId: payload.executionId,
						}),
					);
					value = { kind: "provider_artifact", id: artifactId };
				}
				const resultError =
					boundedValue.kind === "result_too_large"
						? `result_too_large: sandbox value was ${boundedValue.byteSize} bytes`
						: result.error;

				return {
					timing: result.timing,
					status: "completed" as const,
					logs: boundSandboxLogs(result.logs),
					error: boundSandboxError(resultError),
					value,
					scriptAudit: { hash: scriptHash, updatedAt: script.updatedAt.toISOString() },
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
