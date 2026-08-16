import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot-app/contract/errors";
import { SandboxExecutionError } from "@ryot-app/contract/modules/sandbox/schemas";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { generateId } from "better-auth";
import {
	Cause,
	Clock,
	Context,
	Deferred,
	Duration,
	Effect,
	Layer,
	Option,
	Queue,
	Schema,
	FileSystem,
	Path,
} from "effect";

import { AppConfig } from "../config/service";
import { RedisService } from "../redis";
import {
	recordSandboxExecution,
	sandboxMetricKind,
	type SandboxExecutionOutcome,
	type SandboxProcessOutcome,
} from "../runtime-metrics";
import { ServerRun } from "../server-run";
import { SandboxArtifactStore } from "./artifacts";
import { bindSandboxHostFunctions } from "./bridge-adapter";
import { isSandboxCapability } from "./capability-policy";
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
	sandboxArtifactGrant,
	sandboxGrantPathError,
	type SandboxProcessGrants,
} from "./filesystem-grants";
import { SandboxHostImplementations } from "./host-implementations";
import {
	sandboxContextError,
	sandboxRunnerRequestError,
	sandboxScratchQuotaError,
	SANDBOX_LIMITS,
	SANDBOX_RUNNER_LIMITS,
} from "./limits";
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import {
	BridgeService,
	formatSandboxStderr,
	SandboxProcessManager,
	recordSandboxExecutionFinished,
	recordSandboxExecutionStarted,
} from "./runtime";
import {
	isSandboxCapabilityAllowed as isCapabilityAllowed,
	sandboxMetadataKind,
	sandboxPlatformFailureKind,
	type BoundHostFunction,
	type SandboxRunInput,
} from "./shared";
import { makeWorkflowReplayJournalHostFunction } from "./workflow-journal";

const sessionTtlBufferMs = 2_000;
const encoder = new TextEncoder();
const invalidResponseMessage = "Invalid JSON response from Deno process";
const isSandboxCapabilityAllowed = (key: string, input: Pick<SandboxRunInput, "principal">) =>
	isSandboxCapability(key) && isCapabilityAllowed(input, key);

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<SandboxRunInput, "principal" | "workflowExecutionId">,
) => {
	const selectedApiFunctions: Record<string, BoundHostFunction> = {};
	const declaredCapabilities = input.principal.metadata.capabilities ?? [];
	if (input.workflowExecutionId || sandboxMetadataKind(input.principal.metadata) === "workflow") {
		const replayJournal = boundApiFunctions["replayJournal"];
		if (replayJournal) {
			selectedApiFunctions["replayJournal"] = replayJournal;
		}
		for (const key of declaredCapabilities) {
			if (key !== "log" && key !== "span") {
				continue;
			}
			const fn = boundApiFunctions[key];
			if (fn && isSandboxCapabilityAllowed(key, input)) {
				selectedApiFunctions[key] = fn;
			}
		}
		return selectedApiFunctions;
	}
	for (const key of declaredCapabilities) {
		// `artifact-read` and `scratch` are per-execution Deno permission grants honoured at spawn
		// time, never bridge-callable syscalls, so they must never resolve to a bound host function.
		if (key === "replayJournal" || isSandboxFilesystemGrantCapability(key)) {
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
	startedAt: Schema.String,
	moduleUrl: Schema.String,
	executionId: Schema.String,
	compiledFormat: Schema.Finite,
	apiFunctions: Schema.Array(Schema.String),
	workflowExecutionId: Schema.optional(Schema.String),
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

export class SandboxService extends Context.Service<SandboxService>()("SandboxService", {
	make: Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const bridge = yield* BridgeService;
		const fs = yield* FileSystem.FileSystem;
		const artifacts = yield* SandboxArtifactStore;
		const processes = yield* SandboxProcessManager;
		const hostImplementations = yield* SandboxHostImplementations;
		const localTempRoot = yield* fs.realPath(config.fileStorage.localTempDir).pipe(Effect.orDie);

		const harvestRoot = path.join(
			localTempRoot,
			`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
		);

		const apiFunctions = {
			...hostImplementations.runtime,
			...hostImplementations.additional,
			...hostImplementations.automation,
		};

		const runSandbox = (input: SandboxRunInput) =>
			Effect.flatMap(Clock.currentTimeMillis, (executionStartedAt) => {
				const kind = sandboxMetricKind(input.principal.metadata);
				let terminal: {
					readonly durationMs: number;
					readonly responseBytes: number;
					readonly outcome: SandboxExecutionOutcome;
				} | null = null;
				return Effect.scoped(
					Effect.gen(function* () {
						const context = input.context ?? {};
						const contextError = sandboxContextError(context);
						if (contextError) {
							return yield* new SandboxRunError({ message: contextError, kind: "invalid-input" });
						}

						const collector = makeSandboxObservabilityCollector();
						const executionApiFunctions = {
							...apiFunctions,
							...makeObservabilitySandboxApiFunctions(collector),
						};
						const boundApiFunctions: Readonly<Record<string, BoundHostFunction>> = {
							...bindSandboxHostFunctions(executionApiFunctions, input),
							replayJournal: makeWorkflowReplayJournalHostFunction(
								input.workflowExecutionId,
								redis,
							),
						};
						const selectedApiFunctions = selectSandboxHostFunctions(boundApiFunctions, input);
						const declaredCapabilities = (input.principal.metadata.capabilities ?? []).filter(
							(capability) =>
								input.principal.subject.type !== "automation-run" ||
								input.principal.subject.stage !== "before" ||
								POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
						);
						const artifactPath = sandboxArtifactGrant(
							declaredCapabilities,
							input.grants?.artifactPath,
						);
						const namedArtifactPaths = sandboxArtifactGrant(
							declaredCapabilities,
							input.grants?.namedArtifactPaths,
						);
						if (artifactPath !== undefined) {
							const pathError = sandboxGrantPathError(
								path,
								"Sandbox artifact grant path",
								artifactPath,
								localTempRoot,
							);
							if (pathError) {
								return yield* new SandboxRunError({ message: pathError, kind: "invalid-input" });
							}
						}
						for (const [key, artifact] of Object.entries(namedArtifactPaths ?? {})) {
							const pathError = sandboxGrantPathError(
								path,
								`Sandbox named artifact grant path "${key}"`,
								artifact,
								localTempRoot,
							);
							if (pathError) {
								return yield* new SandboxRunError({ message: pathError, kind: "invalid-input" });
							}
						}

						// Acquired before the process and bridge finalizers so LIFO teardown removes the scratch
						// directory last, after the script's process is dead.
						const scratchDirectory = declaresSandboxFilesystemGrant(declaredCapabilities, "scratch")
							? yield* acquireSandboxScratchDirectory(localTempRoot)
							: undefined;

						const token = generateId();
						const modulePath = yield* acquireSandboxCompiledModule(
							processes.runtimePaths,
							input.principal.contentHash,
							input.compiledCode,
						);
						const moduleUrl = (yield* path.toFileUrl(modulePath)).href;
						const requestLine = `${encodeSandboxRunnerRequest({
							token,
							context,
							moduleUrl,
							limits: SANDBOX_RUNNER_LIMITS,
							executionId: input.executionId,
							scriptId: input.principal.scriptId,
							metadata: input.principal.metadata,
							compiledFormat: input.compiledFormat,
							apiBase: `http://127.0.0.1:${bridge.port}`,
							apiFunctions: Object.keys(selectedApiFunctions),
							startedAt: input.startedAt ?? "1970-01-01T00:00:00.000Z",
							...(input.workflowExecutionId
								? { workflowExecutionId: input.workflowExecutionId }
								: {}),
							...(artifactPath !== undefined ||
							namedArtifactPaths !== undefined ||
							scratchDirectory !== undefined
								? { filesystem: { artifactPath, scratchDirectory, namedArtifactPaths } }
								: {}),
						})}\n`;
						const requestError = sandboxRunnerRequestError(requestLine);
						if (requestError) {
							return yield* new SandboxRunError({ message: requestError, kind: "invalid-input" });
						}

						const grants: SandboxProcessGrants = {
							...(artifactPath !== undefined ? { artifactPath } : {}),
							...(scratchDirectory !== undefined ? { scratchDirectory } : {}),
							...(namedArtifactPaths !== undefined ? { namedArtifactPaths } : {}),
						};
						const dedicated =
							artifactPath !== undefined ||
							namedArtifactPaths !== undefined ||
							scratchDirectory !== undefined;
						let workerOutcome: SandboxProcessOutcome = "failure";
						const worker = dedicated
							? yield* processes.spawnDedicated(() => workerOutcome, grants)
							: yield* processes.acquire;
						recordSandboxExecutionStarted();
						yield* Effect.addFinalizer(() => Effect.sync(recordSandboxExecutionFinished));
						if (!dedicated) {
							yield* Effect.addFinalizer(() =>
								Effect.suspend(() => processes.release(worker, workerOutcome)).pipe(Effect.orDie),
							);
						}
						yield* Queue.poll(worker.responseQueue).pipe(Effect.asVoid);

						const timeoutMs = SANDBOX_LIMITS.execution.timeoutMs;
						const now = yield* Clock.currentTimeMillis;
						const parentSpan = yield* Effect.currentSpan;
						yield* bridge.addSession(input.executionId, {
							token,
							parentSpan,
							apiFunctions: selectedApiFunctions,
							hostCallLimit: SANDBOX_LIMITS.hostCalls.total,
							expiresAt: now + timeoutMs + sessionTtlBufferMs,
						});

						yield* Queue.offer(worker.stdinQueue, encoder.encode(requestLine));

						const withProcessStderr = (message: string) =>
							`${message}${formatSandboxStderr(worker.stderrTail.snapshot())}`;
						const processFailure = (message: string) =>
							Deferred.await(worker.stderrClosed).pipe(
								Effect.ignore,
								Effect.andThen(
									Effect.fail(
										new SandboxRunError({
											kind: "infrastructure",
											message: withProcessStderr(message),
										}),
									),
								),
							);
						const processExit = worker.process.exitCode.pipe(
							Effect.flatMap((exitCode) =>
								processFailure(
									`Sandbox process exited with code ${Number(exitCode)} before returning a response`,
								),
							),
							Effect.catchIf(
								(error) => !(error instanceof SandboxRunError),
								() => processFailure("Sandbox process exited before returning a response"),
							),
						);

						const responseLine = yield* Effect.raceFirst(
							Queue.take(worker.responseQueue),
							Effect.raceFirst(
								processExit,
								Effect.sleep(Duration.millis(timeoutMs)).pipe(
									Effect.andThen(
										Effect.fail(
											new TimeoutError({
												message: withProcessStderr(`Sandbox timed out after ${timeoutMs}ms`),
											}),
										),
									),
								),
							),
						);

						const raw = yield* Effect.try({
							try: () => decodeSandboxRunnerResponse(responseLine),
							catch: () =>
								new SandboxRunError({ kind: "infrastructure", message: invalidResponseMessage }),
						});

						// Deno offers no preventive filesystem quota, so the ceiling is measured once the run is
						// over and before anything is harvested out of the directory.
						if (scratchDirectory !== undefined) {
							const quotaError = sandboxScratchQuotaError(
								yield* measureSandboxScratchBytes(scratchDirectory),
							);
							if (quotaError) {
								return yield* new SandboxRunError({ message: quotaError, kind: "script-failure" });
							}
						}

						const completedOutput =
							isObjectRecord(raw.value) && raw.value["state"] === "completed"
								? raw.value["output"]
								: raw.value;
						const manifest =
							scratchDirectory !== undefined && raw.success
								? decodeSandboxScratchManifest(completedOutput)
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
											(error) =>
												new SandboxRunError({
													message: unknownToMessage(error),
													kind: sandboxPlatformFailureKind(error),
												}),
										),
									)
								: [];
						const chunkHandles =
							harvest && input.workflowExecutionId
								? yield* artifacts.materializeOutputs(
										input.grants?.artifactOwnerExecutionId ?? input.workflowExecutionId,
										chunkPaths,
									)
								: [];
						if (harvest) {
							yield* fs.remove(harvest.directory, { force: true, recursive: true });
						}

						const executionMs = raw.timing?.executionMs;
						const finishedAt = yield* Clock.currentTimeMillis;
						const error = raw.success
							? null
							: (raw.error ?? {
									phase: "load",
									kind: "infrastructure",
									message: "Sandbox runner failed without an error",
								});
						const totalMs = Math.max(1, Math.round(finishedAt - now));
						const consoleLogs = "logs" in raw && Array.isArray(raw.logs) ? raw.logs : [];
						const logs = mergeSandboxExecutionLogs(consoleLogs, collector);
						workerOutcome = raw.success ? "success" : "failure";
						terminal = {
							durationMs: totalMs,
							outcome: workerOutcome,
							responseBytes: utf8ByteLength(responseLine),
						};

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
						attributes: {
							sandboxKind: kind,
							executionId: input.executionId,
							scriptId: input.principal.scriptId,
							...(input.workflowExecutionId
								? { workflowExecutionId: input.workflowExecutionId }
								: {}),
						},
					}),
					Effect.mapError((error) =>
						error instanceof TimeoutError || error instanceof SandboxRunError
							? error
							: new SandboxRunError({
									message: unknownToMessage(error),
									kind: sandboxPlatformFailureKind(error),
								}),
					),
					Effect.onExit((exit) =>
						Effect.gen(function* () {
							const observed = terminal;
							if (observed !== null) {
								return yield* recordSandboxExecution({ kind, ...observed });
							}
							const failure =
								exit._tag === "Failure" ? Cause.findErrorOption(exit.cause) : Option.none();
							return yield* recordSandboxExecution({
								kind,
								responseBytes: 0,
								durationMs: Math.max(1, (yield* Clock.currentTimeMillis) - executionStartedAt),
								outcome:
									Option.isSome(failure) && failure.value instanceof TimeoutError
										? "timeout"
										: "failure",
							});
						}),
					),
					Effect.provideService(Path.Path, path),
					Effect.provideService(FileSystem.FileSystem, fs),
				);
			});

		return { run: runSandbox };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(
			Layer.mergeAll(SandboxProcessManager.layer, BridgeService.layer, SandboxArtifactStore.layer),
		),
	);
}
