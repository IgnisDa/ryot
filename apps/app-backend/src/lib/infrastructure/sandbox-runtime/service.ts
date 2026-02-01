import type { HttpClientResponse } from "@effect/platform";
import { FetchHttpClient, FileSystem, HttpClient, HttpClientRequest, Path } from "@effect/platform";
import { isHttpMethod } from "@effect/platform/HttpMethod";
import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import {
	AUTOMATION_SANDBOX_HOST_CAPABILITIES,
	SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES,
} from "@ryot/sandbox-sdk/core";
import { generateId } from "better-auth";
import { Clock, Duration, Effect, Match, Option, Schema, Stream } from "effect";

import { AppConfig } from "../config/service";
import { redisKeys, RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { makeAutomationSandboxApiFunctions } from "./automation-host-functions";
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
import { makeAdditionalSandboxApiFunctions } from "./host-functions";
import {
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxContextError,
	sandboxHttpRequestBodyError,
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
import {
	type BoundHostFunction,
	isJsonValue,
	sandboxHostEffect,
	sandboxHostFailure,
	sandboxRunUserId,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";
import { makeWorkflowDurableCallsHostFunction } from "./workflow-journal";

const httpCallTimeoutMs = 8_000;
const sessionTtlBufferMs = 2_000;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const invalidResponseMessage = "Invalid JSON response from Deno process";
type BunRequestInit = RequestInit & { tls: { rejectUnauthorized: boolean } };
const insecureRequestInit: BunRequestInit = { tls: { rejectUnauthorized: false } };
const defaultHeaders = { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" };
const userAuthorityHostFunctions = new Set<string>(["ensureUserEntities"]);
const systemActivityHostFunctions = new Set<string>(["executeQueryEngine"]);
const userBoundHostFunctions = new Set<string>(["changeUserRelationships"]);
const automationHostFunctions = new Set<string>(AUTOMATION_SANDBOX_HOST_CAPABILITIES);
const systemCronHostFunctions = new Set<string>(SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES);

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<SandboxRunInput, "allowedHostFunctions" | "authority" | "metadata">,
) => {
	const selectedApiFunctions: Record<string, BoundHostFunction> = {};
	if (isWorkflowSandboxMetadata(input.metadata)) {
		const durableCalls = boundApiFunctions["durableCalls"];
		return durableCalls ? { durableCalls } : selectedApiFunctions;
	}
	const isSystemScript =
		input.authority.type === "system" &&
		typeof input.metadata === "object" &&
		input.metadata !== null &&
		"kind" in input.metadata &&
		input.metadata.kind === "script";
	const isSystemActivity =
		input.authority.type === "system" &&
		typeof input.metadata === "object" &&
		input.metadata !== null &&
		"kind" in input.metadata &&
		input.metadata.kind === "activity";
	for (const key of input.allowedHostFunctions) {
		// `artifact-read` and `scratch` are per-execution Deno permission grants honoured at spawn
		// time, never bridge-callable syscalls, so they must never resolve to a bound host function.
		if (key === "durableCalls" || isSandboxFilesystemGrantCapability(key)) {
			continue;
		}
		const fn = boundApiFunctions[key];
		if (
			fn &&
			(!automationHostFunctions.has(key) ||
				input.authority.type === "subscription" ||
				(input.authority.type === "system" && key === "emitSignal")) &&
			(!systemCronHostFunctions.has(key) || isSystemScript) &&
			(input.authority.type !== "system" ||
				!systemActivityHostFunctions.has(key) ||
				isSystemActivity) &&
			(!userAuthorityHostFunctions.has(key) || input.authority.type === "user") &&
			(!userBoundHostFunctions.has(key) || input.authority.type !== "system")
		) {
			selectedApiFunctions[key] = fn;
		}
	}
	return selectedApiFunctions;
};

export const readSandboxHttpResponseText = (response: HttpClientResponse.HttpClientResponse) =>
	response.stream.pipe(
		Stream.runFoldEffect({ bytes: 0, chunks: [] as Uint8Array[] }, (state, chunk) => {
			const bytes = state.bytes + chunk.byteLength;
			return bytes > SANDBOX_LIMITS.http.responseBytes
				? Effect.fail(`httpCall response body exceeds ${SANDBOX_LIMITS.http.responseBytes} bytes`)
				: Effect.succeed({ bytes, chunks: [...state.chunks, chunk] });
		}),
		Effect.map(({ bytes, chunks }) => {
			const body = new Uint8Array(bytes);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return decoder.decode(body);
		}),
	);

export const applySandboxHttpRequestInit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	allowInsecureConnections: boolean | undefined,
) =>
	allowInsecureConnections
		? effect.pipe(Effect.provideService(FetchHttpClient.RequestInit, insecureRequestInit))
		: effect;

const SandboxRunnerRequest = Schema.Struct({
	token: Schema.String,
	apiBase: Schema.String,
	context: Schema.Unknown,
	scriptId: Schema.String,
	metadata: Schema.Unknown,
	moduleUrl: Schema.String,
	executionId: Schema.String,
	compiledFormat: Schema.Number,
	apiFunctions: Schema.Array(Schema.String),
	limits: Schema.Record({ key: Schema.String, value: Schema.Union(Schema.Number, Schema.String) }),
	filesystem: Schema.optional(
		Schema.Struct({
			artifactPath: Schema.optional(Schema.String),
			scratchDirectory: Schema.optional(Schema.String),
			namedArtifactPaths: Schema.optional(
				Schema.Record({ key: Schema.String, value: Schema.String }),
			),
		}),
	),
});

const SandboxRunnerResponse = Schema.Struct({
	success: Schema.Boolean,
	value: Schema.optional(Schema.Unknown),
	logs: Schema.optional(Schema.Array(Schema.String)),
	error: Schema.optional(Schema.NullOr(SandboxExecutionError)),
	timing: Schema.optional(Schema.Struct({ executionMs: Schema.Number })),
});

const encodeSandboxRunnerRequest = Schema.encodeSync(Schema.parseJson(SandboxRunnerRequest));
const decodeSandboxRunnerResponse = Schema.decodeUnknownSync(
	Schema.parseJson(SandboxRunnerResponse),
);

const makeInvalidResponse = () => new SandboxRunError({ message: invalidResponseMessage });

export class SandboxService extends Effect.Service<SandboxService>()("SandboxService", {
	dependencies: [FetchHttpClient.layer, ProcessPool.Default, BridgeService.Default],
	effect: Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const bridge = yield* BridgeService;
		const processes = yield* ProcessPool;
		const fs = yield* FileSystem.FileSystem;

		const httpClient = yield* HttpClient.HttpClient;
		const harvestRoot = path.join(
			config.tmpDir,
			`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
		);

		// `runSandbox` reads `apiFunctions`, and some host functions are built from `runSandbox`
		// (an automation can create events, which evaluates further policies and subscriptions).
		// The late `let` binding ties this mutual reference; `runSandbox` is only ever invoked after
		// `apiFunctions` is assigned below.
		let apiFunctions: Omit<SandboxHostImplementationMap, "log" | "span">;

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
						: yield* processes.pool.get;
					recordSandboxExecutionStarted();
					yield* Effect.addFinalizer(() => Effect.sync(recordSandboxExecutionFinished));
					if (!dedicated) {
						yield* Effect.addFinalizer(() =>
							invalidateProcess(processes.pool, worker).pipe(Effect.orDie),
						);
					}
					yield* worker.responseQueue.takeAll.pipe(Effect.asVoid);

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

					yield* worker.stdinQueue.offer(encoder.encode(requestLine));

					const responseLine = yield* Effect.raceFirst(
						worker.responseQueue.take,
						Effect.sleep(Duration.millis(timeoutMs)).pipe(
							Effect.zipRight(
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
						harvest: harvest ? { chunkPaths, directory: harvest.directory } : null,
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

		const additionalApiFunctions = yield* makeAdditionalSandboxApiFunctions();
		const automationApiFunctions = yield* makeAutomationSandboxApiFunctions();

		apiFunctions = {
			getCachedValue: (input, key) => {
				const keyError = sandboxCacheKeyError("getCachedValue", key);
				if (keyError) {
					return sandboxHostFailure(keyError);
				}

				return sandboxHostEffect(
					redis
						.get(
							redisKeys.sandboxRunCache(
								serverRun.id,
								sandboxRunUserId(input),
								input.cacheNamespace,
								key.trim(),
							),
						)
						.pipe(
							Effect.flatMap((cached) => {
								if (cached === null) {
									return Effect.succeed(null);
								}
								const valueError = sandboxCacheValueError("getCachedValue", cached, "stored value");
								if (valueError) {
									return Effect.fail(valueError);
								}
								return Schema.decode(Schema.parseJson(Schema.Unknown))(cached).pipe(
									Effect.flatMap((value) =>
										isJsonValue(value)
											? Effect.succeed(value)
											: Effect.fail("getCachedValue: stored value is not valid JSON"),
									),
									Effect.mapError(() => "getCachedValue: stored value is not valid JSON"),
								);
							}),
						),
				);
			},
			httpCall: (_input, method, url, options) => {
				if (typeof method !== "string" || !method.trim()) {
					return sandboxHostFailure("httpCall expects a non-empty method string");
				}
				if (typeof url !== "string" || !url.trim()) {
					return sandboxHostFailure("httpCall expects a non-empty URL string");
				}
				const bodyError = sandboxHttpRequestBodyError(options?.body);
				if (bodyError) {
					return sandboxHostFailure(bodyError);
				}

				return sandboxHostEffect(
					Effect.gen(function* () {
						const requestUrl = yield* Effect.try({
							try: () => new URL(url),
							catch: () => "httpCall URL is invalid",
						});
						const httpMethod = yield* Match.value(method.trim().toUpperCase()).pipe(
							Match.when(isHttpMethod, (m) => Effect.succeed(m)),
							Match.orElse(() => Effect.fail("httpCall method is not a valid HTTP method")),
						);
						let request = HttpClientRequest.make(httpMethod)(requestUrl.toString());
						if (options?.body !== undefined) {
							request = HttpClientRequest.bodyText(options.body)(request);
						}
						request = request.pipe(
							HttpClientRequest.setHeaders({ ...defaultHeaders, ...options?.headers }),
						);

						const [response, body] = yield* httpClient.execute(request).pipe(
							(effect) => applySandboxHttpRequestInit(effect, options?.allowInsecureConnections),
							Effect.flatMap((res) =>
								res.status < 200 || res.status >= 300
									? Effect.succeed([res, ""] as const)
									: Effect.map(readSandboxHttpResponseText(res), (text) => [res, text] as const),
							),
							Effect.timeout(Duration.millis(httpCallTimeoutMs)),
							Effect.mapError(unknownToMessage),
						);

						if (response.status < 200 || response.status >= 300) {
							return yield* Effect.fail({
								message: `HTTP ${response.status}`,
								data: { status: response.status },
							});
						}

						return { body, status: response.status, headers: response.headers };
					}),
				);
			},
			setCachedValue: (input, key, value, expiry) => {
				const keyError = sandboxCacheKeyError("setCachedValue", key);
				if (keyError) {
					return sandboxHostFailure(keyError);
				}
				const ttlError = sandboxCacheTtlError("setCachedValue", expiry, "expiry");
				if (ttlError) {
					return sandboxHostFailure(ttlError);
				}

				return sandboxHostEffect(
					Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
						Effect.mapError(() => "setCachedValue value must be JSON-serializable"),
						Effect.flatMap((serialized) => {
							const valueError = sandboxCacheValueError("setCachedValue", serialized);
							return valueError
								? Effect.fail(valueError)
								: redis
										.set(
											redisKeys.sandboxRunCache(
												serverRun.id,
												sandboxRunUserId(input),
												input.cacheNamespace,
												key.trim(),
											),
											serialized,
											expiry,
										)
										.pipe(Effect.as(null));
						}),
					),
				);
			},
			...additionalApiFunctions,
			...automationApiFunctions,
		};

		return { run: runSandbox };
	}),
}) {}
