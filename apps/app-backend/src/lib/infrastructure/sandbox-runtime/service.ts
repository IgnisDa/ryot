import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import {
	SANDBOX_CAPABILITY_REQUIREMENTS,
	type SandboxCapabilityRequirement,
	type SandboxHostCapability,
} from "@ryot/sandbox-sdk/core";
import { generateId } from "better-auth";
import {
	Clock,
	Context,
	Duration,
	Effect,
	Layer,
	Option,
	Pool,
	Queue,
	Schema,
	FileSystem,
	Path,
} from "effect";

import { AppConfig } from "../config/service";
import { RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { bindSandboxHostFunctions } from "./bridge-adapter";
import { acquireSandboxCompiledModule } from "./compiled-modules";
import {
	acquireSandboxScratchDirectory,
	declaresSandboxFilesystemGrant,
	decodeSandboxScratchManifest,
	harvestSandboxScratchChunks,
	isSandboxFilesystemGrantCapability,
	measureSandboxScratchBytes,
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
	sanitizeSandboxExecutionSegment,
	sandboxArtifactGrantPath,
	sandboxNamedArtifactGrantPaths,
	sandboxGrantPathError,
	type SandboxProcessGrants,
} from "./filesystem-grants";
import { SandboxHarvestHandleStore } from "./harvest-handles";
import { SandboxHostImplementations } from "./host-implementations";
import {
	sandboxContextError,
	isWorkflowSandboxMetadata,
	sandboxRunnerRequestError,
	sandboxRunnerLimits,
	sandboxScratchQuotaError,
	SANDBOX_LIMITS,
	WORKFLOW_SANDBOX_LIMITS,
} from "./limits";
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import {
	BridgeService,
	invalidateProcess,
	ProcessPool,
	recordSandboxExecutionFinished,
	recordSandboxExecutionStarted,
} from "./runtime";
import { sandboxMetadataKind, type BoundHostFunction, type SandboxRunInput } from "./shared";
import { makeWorkflowDurableCallsHostFunction } from "./workflow-journal";

const sessionTtlBufferMs = 2_000;
const encoder = new TextEncoder();
const invalidResponseMessage = "Invalid JSON response from Deno process";
const isSandboxCapabilityKey = (key: string): key is SandboxHostCapability =>
	Object.hasOwn(SANDBOX_CAPABILITY_REQUIREMENTS, key);

const sandboxCapabilityRequirement = (
	capability: SandboxHostCapability,
): SandboxCapabilityRequirement => SANDBOX_CAPABILITY_REQUIREMENTS[capability];

const isSandboxCapabilityAllowed = (
	key: string,
	input: Pick<SandboxRunInput, "authority" | "metadata">,
) => {
	if (!isSandboxCapabilityKey(key)) {
		return false;
	}
	const requirement = sandboxCapabilityRequirement(key);
	if (!requirement.bridge || !requirement.authorities.includes(input.authority.type)) {
		return false;
	}
	return (
		input.authority.type !== "system" ||
		requirement.systemKinds === undefined ||
		requirement.systemKinds.some((kind) => kind === sandboxMetadataKind(input.metadata))
	);
};

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<SandboxRunInput, "allowedHostFunctions" | "authority" | "metadata">,
) => {
	const selectedApiFunctions: Record<string, BoundHostFunction> = {};
	if (isWorkflowSandboxMetadata(input.metadata)) {
		const durableCalls = boundApiFunctions["durableCalls"];
		return durableCalls ? { durableCalls } : selectedApiFunctions;
	}
	for (const key of input.allowedHostFunctions) {
		// `artifact-read` and `scratch` are per-execution Deno permission grants honoured at spawn
		// time, never bridge-callable syscalls, so they must never resolve to a bound host function.
		if (key === "durableCalls" || isSandboxFilesystemGrantCapability(key)) {
			continue;
		}
		const fn = boundApiFunctions[key];
		if (fn && isSandboxCapabilityAllowed(key, input)) {
			selectedApiFunctions[key] = fn;
		}
	}
	return selectedApiFunctions;
};

const SandboxRunnerRequest = Schema.Struct({
	token: Schema.String,
	apiBase: Schema.String,
	context: Schema.Unknown,
	scriptId: Schema.String,
	metadata: Schema.Unknown,
	moduleUrl: Schema.String,
	executionId: Schema.String,
	compiledFormat: Schema.Finite,
	apiFunctions: Schema.Array(Schema.String),
	limits: Schema.Record(Schema.String, Schema.Union([Schema.Finite, Schema.String])),
	filesystem: Schema.optional(
		Schema.Struct({
			artifactPath: Schema.optional(Schema.String),
			scratchDirectory: Schema.optional(Schema.String),
			namedArtifactPaths: Schema.optional(Schema.Record(Schema.String, Schema.String)),
		}),
	),
});

const SandboxRunnerResponse = Schema.Struct({
	success: Schema.Boolean,
	value: Schema.optional(Schema.Unknown),
	logs: Schema.optional(Schema.Array(Schema.String)),
	error: Schema.optional(Schema.NullOr(SandboxExecutionError)),
	timing: Schema.optional(Schema.Struct({ executionMs: Schema.Finite })),
});

const encodeSandboxRunnerRequest = Schema.encodeSync(Schema.fromJsonString(SandboxRunnerRequest));
const decodeSandboxRunnerResponse = Schema.decodeUnknownSync(
	Schema.fromJsonString(SandboxRunnerResponse),
);

const makeInvalidResponse = () => new SandboxRunError({ message: invalidResponseMessage });

export class SandboxService extends Context.Service<SandboxService>()("SandboxService", {
	make: Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const bridge = yield* BridgeService;
		const processes = yield* ProcessPool;
		const fs = yield* FileSystem.FileSystem;
		const hostImplementations = yield* SandboxHostImplementations;
		const harvestHandles = yield* SandboxHarvestHandleStore;

		const harvestRoot = path.join(
			config.tmpDir,
			`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
		);

		const apiFunctions = {
			...hostImplementations.runtime,
			...hostImplementations.additional,
			...hostImplementations.automation,
		};

		const runSandbox = (input: SandboxRunInput) =>
			Effect.scoped(
				Effect.gen(function* () {
					const context = input.context ?? {};
					const contextError = sandboxContextError(context, input.metadata);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}

					const collector = makeSandboxObservabilityCollector();
					const executionApiFunctions = {
						...apiFunctions,
						...makeObservabilitySandboxApiFunctions(collector),
					};
					const boundApiFunctions: Readonly<Record<string, BoundHostFunction>> = {
						...bindSandboxHostFunctions(executionApiFunctions, input),
						durableCalls: makeWorkflowDurableCallsHostFunction(input.workflowExecutionId, redis),
					};
					const selectedApiFunctions = selectSandboxHostFunctions(boundApiFunctions, input);
					const artifactPath = sandboxArtifactGrantPath(
						input.allowedHostFunctions,
						input.grants?.artifactPath,
					);
					const namedArtifactPaths = sandboxNamedArtifactGrantPaths(
						input.allowedHostFunctions,
						input.grants?.namedArtifactPaths,
					);
					if (artifactPath !== undefined) {
						const pathError = sandboxGrantPathError(
							path,
							"Sandbox artifact grant path",
							artifactPath,
							config.tmpDir,
						);
						if (pathError) {
							return yield* new SandboxRunError({ message: pathError });
						}
					}
					for (const [key, artifact] of Object.entries(namedArtifactPaths ?? {})) {
						const pathError = sandboxGrantPathError(
							path,
							`Sandbox named artifact grant path "${key}"`,
							artifact,
							config.tmpDir,
						);
						if (pathError) {
							return yield* new SandboxRunError({ message: pathError });
						}
					}

					// Acquired before the process and bridge finalizers so LIFO teardown removes the scratch
					// directory last, after the script's process is dead.
					const scratchDirectory = declaresSandboxFilesystemGrant(
						input.allowedHostFunctions,
						"scratch",
					)
						? yield* acquireSandboxScratchDirectory(config.tmpDir)
						: undefined;

					const token = generateId();
					const modulePath = yield* acquireSandboxCompiledModule(
						processes.runtimePaths,
						input.contentHash,
						input.compiledCode,
					);
					const moduleUrl = (yield* path.toFileUrl(modulePath)).href;
					const requestLine = `${encodeSandboxRunnerRequest({
						token,
						context,
						moduleUrl,
						scriptId: input.scriptId,
						metadata: input.metadata ?? {},
						executionId: input.executionId,
						compiledFormat: input.compiledFormat,
						apiBase: `http://127.0.0.1:${bridge.port}`,
						limits: sandboxRunnerLimits(input.metadata),
						apiFunctions: Object.keys(selectedApiFunctions),
						...(artifactPath !== undefined ||
						namedArtifactPaths !== undefined ||
						scratchDirectory !== undefined
							? { filesystem: { artifactPath, namedArtifactPaths, scratchDirectory } }
							: {}),
					})}\n`;
					const requestError = sandboxRunnerRequestError(requestLine);
					if (requestError) {
						return yield* new SandboxRunError({ message: requestError });
					}

					const grants: SandboxProcessGrants = {
						...(artifactPath !== undefined ? { artifactPath } : {}),
						...(scratchDirectory !== undefined ? { scratchDirectory } : {}),
						...(namedArtifactPaths !== undefined ? { namedArtifactPaths } : {}),
					};
					// `ProcessPool` pre-warms processes before the execution's grants are known, so a
					// grant-carrying execution gets a process spawned for it alone.
					const dedicated =
						artifactPath !== undefined ||
						namedArtifactPaths !== undefined ||
						scratchDirectory !== undefined;
					const worker = dedicated
						? yield* processes.spawnDedicated(grants)
						: yield* Pool.get(processes.pool);
					recordSandboxExecutionStarted();
					yield* Effect.addFinalizer(() => Effect.sync(recordSandboxExecutionFinished));
					if (!dedicated) {
						yield* Effect.addFinalizer(() =>
							invalidateProcess(processes.pool, worker).pipe(Effect.orDie),
						);
					}
					yield* Queue.poll(worker.responseQueue).pipe(Effect.asVoid);

					const workflow = isWorkflowSandboxMetadata(input.metadata);
					const timeoutMs = workflow
						? Math.max(config.sandbox.timeoutMs, WORKFLOW_SANDBOX_LIMITS.timeoutMs)
						: config.sandbox.timeoutMs;
					const now = yield* Clock.currentTimeMillis;
					const parentSpan = yield* Effect.currentSpan;
					yield* bridge.addSession(input.executionId, {
						token,
						parentSpan,
						apiFunctions: selectedApiFunctions,
						expiresAt: now + timeoutMs + sessionTtlBufferMs,
						hostCallLimit: workflow
							? WORKFLOW_SANDBOX_LIMITS.hostCalls.total
							: SANDBOX_LIMITS.hostCalls.total,
					});
					yield* Effect.addFinalizer(() =>
						bridge.removeSession(input.executionId).pipe(Effect.orDie),
					);

					yield* Queue.offer(worker.stdinQueue, encoder.encode(requestLine));

					const responseLine = yield* Effect.raceFirst(
						Queue.take(worker.responseQueue),
						Effect.sleep(Duration.millis(timeoutMs)).pipe(
							Effect.andThen(
								Effect.fail(
									new TimeoutError({
										message: `Sandbox timed out after ${timeoutMs}ms`,
									}),
								),
							),
						),
					);

					const raw = yield* Effect.try({
						try: () => decodeSandboxRunnerResponse(responseLine),
						catch: makeInvalidResponse,
					});

					// Deno offers no preventive filesystem quota, so the ceiling is measured once the run is
					// over and before anything is harvested out of the directory.
					if (scratchDirectory !== undefined) {
						const quotaError = sandboxScratchQuotaError(
							yield* measureSandboxScratchBytes(scratchDirectory),
						);
						if (quotaError) {
							return yield* new SandboxRunError({ message: quotaError });
						}
					}

					const manifest =
						scratchDirectory !== undefined && raw.success
							? decodeSandboxScratchManifest(raw.value)
							: Option.none();
					const harvest = Option.isSome(manifest)
						? {
								chunkFiles: manifest.value.chunkFiles,
								directory: path.join(
									harvestRoot,
									sanitizeSandboxExecutionSegment(input.executionId),
								),
							}
						: null;
					const chunkPaths =
						harvest && scratchDirectory !== undefined
							? yield* harvestSandboxScratchChunks({
									scratchDirectory,
									chunkFiles: harvest.chunkFiles,
									destination: harvest.directory,
								}).pipe(
									Effect.mapError(
										(error) => new SandboxRunError({ message: unknownToMessage(error) }),
									),
								)
							: [];
					const chunkHandles =
						harvest && input.workflowExecutionId
							? yield* harvestHandles.register(input.workflowExecutionId, chunkPaths)
							: [];
					if (harvest && !input.workflowExecutionId) {
						yield* fs.remove(harvest.directory, { force: true, recursive: true });
					}

					const executionMs = raw.timing?.executionMs;
					const finishedAt = yield* Clock.currentTimeMillis;
					const error = raw.success
						? null
						: (raw.error ?? { phase: "load", message: "Sandbox runner failed without an error" });
					const totalMs = Math.max(1, Math.round(finishedAt - now));
					const consoleLogs = "logs" in raw && Array.isArray(raw.logs) ? raw.logs : [];
					const logs = mergeSandboxExecutionLogs(consoleLogs, collector);

					return {
						logs,
						error,
						success: raw.success,
						executionId: input.executionId,
						value: raw.success ? (raw.value ?? null) : null,
						harvest: harvest && input.workflowExecutionId ? { chunkHandles } : null,
						timing: { totalMs, executionMs: typeof executionMs === "number" ? executionMs : 0 },
					};
				}),
			).pipe(
				Effect.withSpan("sandbox.execution", {
					attributes: { scriptId: input.scriptId, executionId: input.executionId },
				}),
				Effect.mapError((error) =>
					error instanceof TimeoutError || error instanceof SandboxRunError
						? error
						: new SandboxRunError({ message: unknownToMessage(error) }),
				),
				Effect.provideService(Path.Path, path),
				Effect.provideService(FileSystem.FileSystem, fs),
			);

		return { run: runSandbox };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(
			Layer.mergeAll(ProcessPool.layer, BridgeService.layer, SandboxHarvestHandleStore.layer),
		),
	);
}
