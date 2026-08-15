import { setPriority } from "node:os";

import { BunHttpServer } from "@effect/platform-bun";
import { badRequest, internalError, unknownToMessage } from "@ryot-app/contract/errors";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { hostFailure } from "@ryot-app/sandbox-sdk/wire";
import {
	Clock,
	Context,
	Data,
	Deferred,
	Effect,
	Layer,
	Option,
	Pool,
	Queue,
	Schema,
	Stream,
	type Tracer,
	FileSystem,
	Semaphore,
} from "effect";
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { sandboxDenoDirConfig } from "../config/definition";
import { AppConfig } from "../config/service";
import {
	recordSandboxHostCall,
	recordSandboxProcessCompleted,
	recordSandboxProcessSpawned,
	recordSandboxRuntimeGauges,
	getSandboxReplayCounters,
	getProviderImportExecutingBodies,
	getProviderImportPhaseSegments,
	type SandboxProcessOutcome,
} from "../runtime-metrics";
import { materializeShippedSandboxRuntime } from "./dependencies";
import type { SandboxProcessGrants } from "./filesystem-grants";
import { consumeSandboxHostCall, SANDBOX_LIMITS, type SandboxHostCallBudget } from "./limits";
import {
	readCgroupSample,
	readProcessCpuSample,
	readProcessMemoryStatus,
	readProcessSmapsRollup,
	type CgroupSample,
	type ProcessCpuSample,
	type SmapsRollup,
} from "./process-sampling";
import { sandboxRunnerSource } from "./runner.generated";
import { sandboxRuntimePayloadMetadata } from "./runtime-payload-metadata.generated";
import type { BoundHostFunction } from "./shared";
import { readSandboxByteLimitedText } from "./stream-utils";

const SandboxRpcArgs = Schema.Struct({ args: Schema.Array(Schema.Unknown) });

const decodeSandboxRpcBody = Schema.decodeUnknownEffect(Schema.fromJsonString(SandboxRpcArgs));
const encodeSandboxRpcResponse = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const closeSession = (session: ActiveExecutionSession | undefined) => {
	if (session) {
		Deferred.doneUnsafe(session.closed, Effect.void);
	}
};

const oversizedBridgeRequest = Symbol("oversizedBridgeRequest");
const SANDBOX_PROCESS_GAUGE_INTERVAL = "1 second";
const COMPLETED_WORKER_CAPACITY = 1_024;
let totalSandboxExecutions = 0;
let activeSandboxExecutions = 0;
let maxActiveSandboxExecutions = 0;

export const recordSandboxExecutionStarted = () => {
	activeSandboxExecutions += 1;
	totalSandboxExecutions += 1;
	maxActiveSandboxExecutions = Math.max(maxActiveSandboxExecutions, activeSandboxExecutions);
};

export const recordSandboxExecutionFinished = () => {
	activeSandboxExecutions -= 1;
};

export const getSandboxProcessMetrics = () => ({
	totalExecutions: totalSandboxExecutions,
	activeExecutions: activeSandboxExecutions,
	maxActiveExecutions: maxActiveSandboxExecutions,
});

export type SandboxProfileCheckpointHandler = (
	checkpoint: string,
	body: string,
) => Effect.Effect<void, unknown>;

type ExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
	readonly hostCallLimit: number;
	readonly parentSpan: Tracer.AnySpan;
	readonly apiFunctions: Record<string, BoundHostFunction>;
	readonly onProfileCheckpoint?: SandboxProfileCheckpointHandler;
};

type ActiveExecutionSession = {
	readonly onProfileCheckpoint?: SandboxProfileCheckpointHandler;
	readonly token: string;
	expiresAt: number;
	readonly hostCallLimit: number;
	readonly parentSpan: Tracer.AnySpan;
	readonly budget: SandboxHostCallBudget;
	readonly semaphore: Semaphore.Semaphore;
	readonly closed: Deferred.Deferred<void>;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

export type SandboxStderrSnapshot = {
	readonly truncated: boolean;
	readonly lines: ReadonlyArray<string>;
};

export type SandboxStderrTail = {
	readonly append: (line: string) => void;
	readonly snapshot: () => SandboxStderrSnapshot;
};

type SandboxProcess = {
	readonly inspectorUrl: Deferred.Deferred<string> | undefined;
	readonly stderrTail: SandboxStderrTail;
	readonly responseQueue: Queue.Queue<string>;
	readonly stdinQueue: Queue.Queue<Uint8Array>;
	readonly stderrClosed: Deferred.Deferred<void>;
	readonly process: ChildProcessSpawner.ChildProcessHandle;
};

export type SandboxWorkerSample = {
	readonly pid: number;
	readonly rssBytes: number;
	readonly hwmBytes: number | null;
	readonly smapsRollup: SmapsRollup | null;
	readonly userCpuTicks: number | null;
	readonly systemCpuTicks: number | null;
	readonly startTimeTicks: number | null;
};

export type SandboxCompletedWorker = {
	readonly pid: number;
	readonly executionKey: string | null;
	readonly sequence: number;
	readonly spawnedAtMs: number;
	readonly releasedAtMs: number;
	readonly outcome: SandboxProcessOutcome;
	readonly lifetimePeakRssBytes: number | null;
};

export type SandboxRuntimeMetricsOptions = {
	readonly includeSmaps: boolean;
	readonly completedAfterSequence: number;
};

export type SandboxProcessRuntimeMetrics = {
	readonly timestampMs: number;
	readonly completedWorkerSequence: number;
	readonly completedWorkers: ReadonlyArray<SandboxCompletedWorker>;
	readonly configuration: {
		readonly processMode: string;
		readonly workerConcurrency: number;
		readonly benchmarkProfilingEnabled: boolean;
		readonly schedulerDispatchersDisabled: boolean;
	};
	readonly runtime: { readonly bunVersion: string; readonly denoVersion: string };
	readonly providerImports: {
		readonly executingBodies: number;
		readonly phaseSegmentSequence: number;
	};
	readonly totalSpawned: number;
	readonly workerRssBytes: number;
	readonly totalCompleted: number;
	readonly backendRssBytes: number;
	readonly activeProcessCount: number;
	readonly cgroup: CgroupSample | null;
	readonly workers: ReadonlyArray<SandboxWorkerSample>;
	readonly backend: {
		readonly hwmBytes: number | null;
		readonly smapsRollup: SmapsRollup | null;
		readonly rssBytes: number;
		readonly heapUsedBytes: number;
		readonly heapTotalBytes: number;
		readonly externalBytes: number;
		readonly arrayBuffersBytes: number;
		readonly userCpuMicros: number | null;
		readonly systemCpuMicros: number | null;
	};
	readonly deno: {
		readonly processCount: number;
		readonly rssBytes: number;
		readonly userCpuTicks: number | null;
		readonly systemCpuTicks: number | null;
	};
	readonly executions: {
		readonly total: number;
		readonly active: number;
		readonly maxActive: number;
	};
	readonly replays: {
		readonly totalStarted: number;
		readonly totalFailed: number;
		readonly totalCompleted: number;
		readonly totalJournalBytes: number;
		readonly totalDurableRequests: number;
	};
};

class SandboxProcessMemoryReadError extends Data.TaggedError("SandboxProcessMemoryReadError")<{}> {}

const readBackendSample = () => {
	const memory = process.memoryUsage();
	const cpu = process.cpuUsage();
	return {
		rssBytes: memory.rss,
		userCpuMicros: cpu.user,
		systemCpuMicros: cpu.system,
		heapUsedBytes: memory.heapUsed,
		externalBytes: memory.external,
		heapTotalBytes: memory.heapTotal,
		arrayBuffersBytes: memory.arrayBuffers,
	};
};

type WorkerProcessSample = {
	readonly rssBytes: number;
	readonly hwmBytes: number | null;
	readonly cpu: ProcessCpuSample | null;
	readonly smapsRollup: SmapsRollup | null;
};

// A worker can exit between listing and reading, so an unreadable PID is omitted from the
// sample instead of failing it.
const readWorkerSamples = (pids: ReadonlyArray<number>, includeSmaps: boolean) =>
	Effect.forEach(
		pids,
		(pid) =>
			Effect.all([
				readProcessMemoryStatus(pid),
				readProcessCpuSample(pid),
				includeSmaps ? readProcessSmapsRollup(pid) : Effect.succeed(null),
			]).pipe(
				Effect.map(([status, cpu, smapsRollup]) =>
					status?.rssBytes === null || status === null
						? null
						: ([
								pid,
								{ cpu, smapsRollup, rssBytes: status.rssBytes, hwmBytes: status.hwmBytes },
							] as const),
				),
			),
		{ concurrency: "unbounded" },
	).pipe(
		Effect.map(
			(entries) =>
				new Map<number, WorkerProcessSample>(
					entries.flatMap((entry) => (entry === null ? [] : [entry])),
				),
		),
	);

const readBackendProcessSample = (includeSmaps: boolean) =>
	process.platform === "linux"
		? Effect.all([
				readProcessMemoryStatus("self"),
				includeSmaps ? readProcessSmapsRollup("self") : Effect.succeed(null),
			]).pipe(
				Effect.map(([status, smapsRollup]) => ({
					...readBackendSample(),
					smapsRollup,
					hwmBytes: status?.hwmBytes ?? null,
				})),
			)
		: Effect.succeed({ ...readBackendSample(), hwmBytes: null, smapsRollup: null });

const sandboxRuntimeVersions = {
	bunVersion: Bun.version,
	denoVersion: sandboxRuntimePayloadMetadata.metadata.denoVersion,
};

const providerImportMetrics = () => ({
	executingBodies: getProviderImportExecutingBodies(),
	phaseSegmentSequence: getProviderImportPhaseSegments(0).at(-1)?.sequence ?? 0,
});

const emptySandboxProcessRuntimeMetrics = (options: SandboxRuntimeMetricsOptions) =>
	Effect.all([Clock.currentTimeMillis, readBackendProcessSample(options.includeSmaps)]).pipe(
		Effect.map(
			([timestampMs, backend]): SandboxProcessRuntimeMetrics => ({
				backend,
				timestampMs,
				workers: [],
				cgroup: null,
				totalSpawned: 0,
				totalCompleted: 0,
				workerRssBytes: 0,
				completedWorkers: [],
				activeProcessCount: 0,
				completedWorkerSequence: 0,
				runtime: sandboxRuntimeVersions,
				backendRssBytes: backend.rssBytes,
				replays: getSandboxReplayCounters(),
				providerImports: providerImportMetrics(),
				deno: { rssBytes: 0, processCount: 0, userCpuTicks: null, systemCpuTicks: null },
				executions: {
					total: totalSandboxExecutions,
					active: activeSandboxExecutions,
					maxActive: maxActiveSandboxExecutions,
				},
				configuration: {
					workerConcurrency: 0,
					processMode: "unavailable",
					benchmarkProfilingEnabled: false,
					schedulerDispatchersDisabled: false,
				},
			}),
		),
	);

let runtimeMetricsReader: (
	options: SandboxRuntimeMetricsOptions,
) => Effect.Effect<SandboxProcessRuntimeMetrics> = emptySandboxProcessRuntimeMetrics;

export const getSandboxRuntimeMetrics = (
	options: SandboxRuntimeMetricsOptions = { includeSmaps: false, completedAfterSequence: 0 },
) => Effect.suspend(() => runtimeMetricsReader(options));

const truncateSandboxStderrLine = (line: string) => {
	const limit = SANDBOX_LIMITS.diagnostics.stderrBytes;
	if (utf8ByteLength(line) <= limit) {
		return line;
	}
	const marker = " [sandbox stderr line truncated]";
	const markerBytes = utf8ByteLength(marker);
	const bytes = new TextEncoder().encode(line);
	const stderrDecoder = new TextDecoder("utf-8", { fatal: true });
	let prefixBytes = Math.max(0, limit - markerBytes);
	while (prefixBytes > 0) {
		try {
			return `${stderrDecoder.decode(bytes.subarray(0, prefixBytes))}${marker}`;
		} catch {
			prefixBytes -= 1;
		}
	}
	return marker;
};

export const makeSandboxStderrTail = (): SandboxStderrTail => {
	let bytes = 0;
	let truncated = false;
	const lines: string[] = [];

	return {
		snapshot: () => ({ truncated, lines: [...lines] }),
		append: (line) => {
			const value = truncateSandboxStderrLine(line);
			truncated ||= value !== line;
			lines.push(value);
			bytes += utf8ByteLength(value);
			while (
				lines.length > SANDBOX_LIMITS.diagnostics.stderrLines ||
				bytes > SANDBOX_LIMITS.diagnostics.stderrBytes
			) {
				const removed = lines.shift();
				if (removed === undefined) {
					break;
				}
				bytes -= utf8ByteLength(removed);
				truncated = true;
			}
		},
	};
};

export const formatSandboxStderr = ({ lines, truncated }: SandboxStderrSnapshot) =>
	lines.length === 0
		? ""
		: `\nSandbox stderr:\n${truncated ? "[sandbox stderr truncated]\n" : ""}${lines.join("\n")}`;

export const readSandboxBridgeRequestBody = (request: Request) => {
	const stream = request.body;
	if (!stream) {
		return Effect.succeed({ body: "", oversized: false } as const);
	}

	return readSandboxByteLimitedText(
		Stream.fromAsyncIterable(stream, () => badRequest("Invalid request body")),
		SANDBOX_LIMITS.bridge.requestBytes,
		oversizedBridgeRequest,
	).pipe(
		Effect.map((body) => ({ body, oversized: false }) as const),
		Effect.catchIf(
			(error) => error === oversizedBridgeRequest,
			() => Effect.succeed({ body: "", oversized: true } as const),
		),
	);
};

const hostFailureResponse = (message: string) =>
	Response.json({ result: hostFailure(message) }, { status: 200 });

export const sandboxBridgeResultResponse = (
	result: unknown,
	maximumBytes = SANDBOX_LIMITS.bridge.responseBytes,
) =>
	encodeSandboxRpcResponse({ result }).pipe(
		Effect.map((body) =>
			utf8ByteLength(body) > maximumBytes
				? hostFailureResponse(`Sandbox bridge response exceeds ${maximumBytes} UTF-8 bytes`)
				: new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
		),
		Effect.orElseSucceed(() => hostFailureResponse("Sandbox bridge response is not valid JSON")),
	);

export const runSandboxBridgeHostFunction = (
	fn: BoundHostFunction,
	args: ReadonlyArray<unknown>,
	input: { executionId: string; fnName: string; parentSpan: Tracer.AnySpan },
) =>
	fn(args).pipe(
		Effect.withSpan(`sandbox.host.${input.fnName}`, {
			attributes: { functionName: input.fnName, executionId: input.executionId },
		}),
		Effect.withParentSpan(input.parentSpan),
		Effect.onExit((exit) =>
			recordSandboxHostCall({
				function: input.fnName,
				outcome: exit._tag === "Success" ? "success" : "failure",
			}),
		),
	);

export const withSandboxHostCallPermit = <A, E, R>(
	semaphore: Semaphore.Semaphore,
	effect: Effect.Effect<A, E, R>,
) => semaphore.withPermits(1)(effect);

const killProcessHandle = (process: ChildProcessSpawner.ChildProcessHandle) =>
	process.kill().pipe(Effect.ignore);

export type SandboxProcessProfiling = {
	readonly directory: string;
	readonly inspector: boolean;
	readonly cpuProfile: boolean;
};

type SpawnDenoProcessOptions = {
	readonly deprioritize?: boolean;
	readonly profiling?: SandboxProcessProfiling;
	readonly denoDir: string;
	readonly bridgePort: number;
	readonly runnerPath: string;
	readonly importMapPath: string;
	readonly runtimeDirectory: string;
	readonly grants?: SandboxProcessGrants;
};

// A grant-carrying execution replaces the blanket `--deny-write` with a write grant scoped to its
// own scratch directory; an execution without grants must keep today's flags byte for byte.
export const sandboxDenoRunFlags = (options: Omit<SpawnDenoProcessOptions, "denoDir">) => {
	const scratchDirectory = options.grants?.scratchDirectory;
	const readPaths = [options.runnerPath, options.runtimeDirectory];
	if (options.grants?.artifactPath) {
		readPaths.push(options.grants.artifactPath);
	}
	readPaths.push(...Object.values(options.grants?.namedArtifactPaths ?? {}));
	if (scratchDirectory) {
		readPaths.push(scratchDirectory);
	}

	return [
		"--deny-run",
		"--deny-env",
		"--deny-ffi",
		scratchDirectory ? `--allow-write=${scratchDirectory}` : "--deny-write",
		"--no-prompt",
		"--no-config",
		"--no-lock",
		"--no-npm",
		"--no-remote",
		"--cached-only",
		`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
		`--import-map=${options.importMapPath}`,
		`--allow-read=${readPaths.join(",")}`,
		`--allow-net=127.0.0.1:${options.bridgePort}`,
	];
};

export const sandboxProfilingFlags = (profiling: SandboxProcessProfiling | undefined) =>
	profiling === undefined
		? []
		: [
				...(profiling.cpuProfile
					? [`--cpu-prof-dir=${profiling.directory}`, "--cpu-prof-name=cpu.cpuprofile"]
					: []),
				...(profiling.inspector ? ["--inspect=127.0.0.1:0"] : []),
			];

/** Nice level for workers: the API and workflow engine keep CPU while workers compete for it. */
export const SANDBOX_WORKER_NICE = 10;
/** The kernel's maximum badness bonus, so a memory limit terminates a worker before the backend. */
export const SANDBOX_WORKER_OOM_SCORE_ADJ = 1000;

/**
 * Raising niceness and `oom_score_adj` needs no privilege for an owned child. A worker that has
 * already exited cannot be adjusted, and a failure leaves the worker at the backend's priority.
 */
const deprioritizeSandboxProcess = (pid: number) =>
	Effect.try(() => setPriority(pid, SANDBOX_WORKER_NICE)).pipe(
		Effect.andThen(
			process.platform === "linux"
				? Effect.tryPromise(() =>
						Bun.write(`/proc/${pid}/oom_score_adj`, `${SANDBOX_WORKER_OOM_SCORE_ADJ}`),
					)
				: Effect.void,
		),
		Effect.catch((error) =>
			Effect.logWarning("sandbox worker priority could not be lowered").pipe(
				Effect.annotateLogs({ pid, error: unknownToMessage(error) }),
			),
		),
	);

const makeSpawnDenoProcess = Effect.fn("makeSpawnDenoProcess")(function* (
	options: SpawnDenoProcessOptions,
) {
	const path = Bun.env["PATH"];
	if (!path) {
		return yield* Effect.die(new Error("Sandbox process PATH is unavailable"));
	}
	const denoProcess = yield* ChildProcess.make(
		"deno",
		[
			"run",
			...sandboxDenoRunFlags(options),
			...sandboxProfilingFlags(options.profiling),
			options.runnerPath,
		],
		{
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			extendEnv: false,
			env: { PATH: path, DENO_DIR: options.denoDir },
		},
	);

	yield* Effect.addFinalizer(() => killProcessHandle(denoProcess));
	if (options.deprioritize) {
		yield* deprioritizeSandboxProcess(Number(denoProcess.pid));
	}

	const responseQueue = yield* Queue.unbounded<string>();
	const stdinQueue = yield* Queue.unbounded<Uint8Array>();
	const stderrClosed = yield* Deferred.make<void>();
	const stderrTail = makeSandboxStderrTail();
	const inspectorUrl = options.profiling?.inspector ? yield* Deferred.make<string>() : undefined;

	yield* Stream.fromQueue(stdinQueue).pipe(Stream.run(denoProcess.stdin), Effect.forkScoped);

	yield* denoProcess.stdout.pipe(
		Stream.decodeText({ encoding: "utf-8" }),
		Stream.splitLines,
		Stream.runForEach((line) => Queue.offer(responseQueue, line).pipe(Effect.asVoid)),
		Effect.forkScoped,
	);

	yield* denoProcess.stderr.pipe(
		Stream.decodeText({ encoding: "utf-8" }),
		Stream.splitLines,
		Stream.runForEach((line) => {
			stderrTail.append(line);
			const listening = inspectorUrl && /Debugger listening on (ws:\/\/\S+)/.exec(line)?.[1];
			return listening ? Deferred.succeed(inspectorUrl, listening) : Effect.void;
		}),
		Effect.ensuring(Deferred.succeed(stderrClosed, undefined)),
		Effect.forkScoped,
	);

	return {
		stdinQueue,
		stderrTail,
		inspectorUrl,
		stderrClosed,
		responseQueue,
		process: denoProcess,
	};
});

export class BridgeService extends Context.Service<BridgeService>()("BridgeService", {
	make: Effect.gen(function* () {
		const activeSessions = new Map<string, ActiveExecutionSession>();

		const evictSession = (executionId: string, session: ActiveExecutionSession) => {
			if (activeSessions.get(executionId) === session) {
				activeSessions.delete(executionId);
			}
			closeSession(session);
		};

		const addSession = Effect.fn("BridgeService.addSession")(function* (
			executionId: string,
			session: ExecutionSession,
		) {
			const closed = yield* Deferred.make<void>();
			const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.bridge.concurrentHostCalls);
			const active: ActiveExecutionSession = {
				closed,
				semaphore,
				token: session.token,
				expiresAt: session.expiresAt,
				budget: { http: 0, total: 0 },
				parentSpan: session.parentSpan,
				apiFunctions: session.apiFunctions,
				hostCallLimit: session.hostCallLimit,
				...(session.onProfileCheckpoint
					? { onProfileCheckpoint: session.onProfileCheckpoint }
					: {}),
			};
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					closeSession(activeSessions.get(executionId));
					activeSessions.set(executionId, active);
				}),
				() => Effect.sync(() => evictSession(executionId, active)),
			);
			return {
				/** Moves expiry past time the runner spent blocked on host-settled durable work. */
				extend: (durationMs: number) =>
					Effect.sync(() => {
						active.expiresAt += Math.max(0, durationMs);
					}),
			};
		});

		const handleRequest = Effect.fn("BridgeService.handleRequest")(
			function* (request: Request) {
				if (request.method !== "POST") {
					return Response.json({ error: "Not found" }, { status: 404 });
				}

				const url = new URL(request.url);
				const parts = url.pathname.split("/").filter(Boolean);
				if (parts.length !== 3 || (parts[0] !== "rpc" && parts[0] !== "profile")) {
					return Response.json({ error: "Not found" }, { status: 404 });
				}

				const executionId = decodeURIComponent(parts[1] ?? "");
				const fnName = decodeURIComponent(parts[2] ?? "");
				const activeSession = activeSessions.get(executionId);
				if (!activeSession) {
					return Response.json({ error: "Execution not found" }, { status: 404 });
				}

				const now = yield* Clock.currentTimeMillis;
				if (now > activeSession.expiresAt) {
					yield* Effect.sync(() => evictSession(executionId, activeSession));
					return Response.json({ error: "Execution expired" }, { status: 410 });
				}

				const authHeader = request.headers.get("authorization");
				if (authHeader !== `Bearer ${activeSession.token}`) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				if (parts[0] === "profile") {
					const onProfileCheckpoint = activeSession.onProfileCheckpoint;
					if (!onProfileCheckpoint) {
						return Response.json({ error: "Not found" }, { status: 404 });
					}
					const checkpointBody = yield* readSandboxBridgeRequestBody(request);
					yield* onProfileCheckpoint(fnName, checkpointBody.body).pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Sandbox profile checkpoint failed", cause),
						),
					);
					return Response.json({}, { status: 200 });
				}

				const budgetError = consumeSandboxHostCall(
					activeSession.budget,
					fnName,
					activeSession.hostCallLimit,
				);
				if (budgetError) {
					return hostFailureResponse(budgetError);
				}

				const functions = activeSession.apiFunctions;
				if (!Object.hasOwn(functions, fnName)) {
					return Response.json({ error: "Unknown function" }, { status: 404 });
				}

				const fn = functions[fnName];
				if (!fn) {
					return Response.json({ error: "Unknown function" }, { status: 404 });
				}

				const contentLength = Number(request.headers.get("content-length") ?? 0);
				if (Number.isFinite(contentLength) && contentLength > SANDBOX_LIMITS.bridge.requestBytes) {
					return hostFailureResponse(
						`Sandbox bridge request exceeds ${SANDBOX_LIMITS.bridge.requestBytes} UTF-8 bytes`,
					);
				}
				const requestBody = yield* readSandboxBridgeRequestBody(request);
				if (requestBody.oversized) {
					return hostFailureResponse(
						`Sandbox bridge request exceeds ${SANDBOX_LIMITS.bridge.requestBytes} UTF-8 bytes`,
					);
				}
				const args = yield* decodeSandboxRpcBody(requestBody.body).pipe(
					Effect.map((body) => body.args),
					Effect.mapError(() => badRequest("Invalid request body")),
				);
				const hostCall = runSandboxBridgeHostFunction(fn, args, {
					fnName,
					executionId,
					parentSpan: activeSession.parentSpan,
				}).pipe(
					Effect.mapError((error) => internalError(unknownToMessage(error))),
					Effect.flatMap((result) =>
						sandboxBridgeResultResponse(
							result,
							fnName === "replayJournal"
								? SANDBOX_LIMITS.bridge.durableResponseBytes
								: SANDBOX_LIMITS.bridge.responseBytes,
						),
					),
					Effect.catch((error) =>
						Effect.succeed(Response.json({ error: unknownToMessage(error) }, { status: 500 })),
					),
				);
				return yield* withSandboxHostCallPermit(activeSession.semaphore, hostCall).pipe(
					Effect.raceFirst(
						Deferred.await(activeSession.closed).pipe(
							Effect.as(Response.json({ error: "Execution ended" }, { status: 410 })),
						),
					),
				);
			},
			Effect.catch((error) =>
				Effect.succeed(Response.json({ error: unknownToMessage(error) }, { status: 400 })),
			),
		);

		const server = yield* BunHttpServer.make({ port: 0, hostname: "127.0.0.1" });
		yield* HttpServer.serveEffect(
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;
				const webRequest = yield* HttpServerRequest.toWeb(request);
				return HttpServerResponse.fromWeb(yield* handleRequest(webRequest));
			}),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		if (address._tag === "UnixPathAddress") {
			return yield* Effect.die("Sandbox bridge unexpectedly bound to a Unix socket");
		}

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const session of activeSessions.values()) {
					closeSession(session);
				}
				activeSessions.clear();
			}),
		);

		return { addSession, port: address.port };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

class RunnerFile extends Context.Service<RunnerFile>()("RunnerFile", {
	make: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-runner-" });
		const path = `${directory}/runner.mjs`;
		yield* fs.writeFileString(path, sandboxRunnerSource);
		return { path };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export class PackageCacheManager extends Context.Service<PackageCacheManager>()(
	"PackageCacheManager",
	{
		make: Effect.gen(function* () {
			const denoDir = yield* sandboxDenoDirConfig;
			return yield* materializeShippedSandboxRuntime(denoDir);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class SandboxProcessManager extends Context.Service<SandboxProcessManager>()(
	"SandboxProcessManager",
	{
		make: Effect.gen(function* () {
			const runner = yield* RunnerFile;
			const bridge = yield* BridgeService;
			const config = yield* AppConfig;
			const dependencies = yield* PackageCacheManager;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			// Capture the executor so callers only need the process manager service.
			const spawn = (grants?: SandboxProcessGrants, profiling?: SandboxProcessProfiling) =>
				makeSpawnDenoProcess({
					bridgePort: bridge.port,
					runnerPath: runner.path,
					deprioritize: config.sandbox.experimentWorkerPriority,
					...(grants ? { grants } : {}),
					...(profiling ? { profiling } : {}),
					denoDir: dependencies.cacheDirectory,
					runtimeDirectory: dependencies.directory,
					importMapPath: dependencies.importMapPath,
				}).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
			const spawnedAt = new Map<number, number>();
			const executionKeys = new Map<number, string>();
			const completedWorkers: SandboxCompletedWorker[] = [];
			let totalSpawned = 0;
			let totalCompleted = 0;
			let completedWorkerSequence = 0;
			const track = (worker: SandboxProcess) =>
				Effect.map(Clock.currentTimeMillis, (now) => {
					const pid = Number(worker.process.pid);
					if (Number.isSafeInteger(pid) && pid > 0) {
						spawnedAt.set(pid, now);
						totalSpawned += 1;
					}
				});
			// The lifetime high-water mark is read before the kill, so workers that start and exit
			// between two snapshots still report an observed peak.
			const finish = (worker: SandboxProcess, outcome: SandboxProcessOutcome) =>
				Effect.gen(function* () {
					const pid = Number(worker.process.pid);
					const startedAtMs = spawnedAt.get(pid);
					if (startedAtMs === undefined) {
						return;
					}
					const status = process.platform === "linux" ? yield* readProcessMemoryStatus(pid) : null;
					const releasedAtMs = yield* Clock.currentTimeMillis;
					if (!spawnedAt.delete(pid)) {
						return;
					}
					const executionKey = executionKeys.get(pid) ?? null;
					executionKeys.delete(pid);
					totalCompleted += 1;
					completedWorkerSequence += 1;
					completedWorkers.push({
						pid,
						outcome,
						executionKey,
						releasedAtMs,
						spawnedAtMs: startedAtMs,
						sequence: completedWorkerSequence,
						lifetimePeakRssBytes: status?.hwmBytes ?? null,
					});
					if (completedWorkers.length > COMPLETED_WORKER_CAPACITY) {
						completedWorkers.shift();
					}
				});
			const spawnTracked = (
				dedicated: boolean,
				grants?: SandboxProcessGrants,
				profiling?: SandboxProcessProfiling,
			) =>
				spawn(grants, profiling).pipe(
					Effect.tap(track),
					Effect.tap(() => recordSandboxProcessSpawned(dedicated)),
				);
			const complete = (worker: SandboxProcess, outcome: SandboxProcessOutcome) =>
				finish(worker, outcome).pipe(Effect.andThen(recordSandboxProcessCompleted(outcome)));
			const pool =
				config.sandbox.processMode === "warm"
					? yield* Pool.make({
							acquire: spawnTracked(false),
							size: config.sandbox.workerConcurrency + 2,
						})
					: undefined;
			const acquire = pool === undefined ? spawnTracked(false) : Pool.get(pool);
			const release = (worker: SandboxProcess, outcome: SandboxProcessOutcome) =>
				complete(worker, outcome).pipe(
					Effect.andThen(pool === undefined ? Effect.void : Pool.invalidate(pool, worker)),
					Effect.andThen(killProcessHandle(worker.process)),
				);
			const spawnDedicated = (
				outcome: () => SandboxProcessOutcome,
				grants?: SandboxProcessGrants,
				profiling?: SandboxProcessProfiling,
			) =>
				spawnTracked(true, grants, profiling).pipe(
					Effect.tap((worker) =>
						Effect.addFinalizer(() => Effect.suspend(() => complete(worker, outcome()))),
					),
				);
			const readWorkerMemory = (pids: ReadonlyArray<number>, includeSmaps: boolean) => {
				if (process.platform === "linux") {
					return readWorkerSamples(pids, includeSmaps);
				}
				return Effect.try({
					catch: () => new SandboxProcessMemoryReadError(),
					try: () => {
						const samples = new Map<number, WorkerProcessSample>();
						if (pids.length === 0) {
							return samples;
						}
						const result = Bun.spawnSync(["ps", "-o", "pid=,rss=", "-p", pids.join(",")]);
						if (result.exitCode !== 0) {
							return samples;
						}
						for (const line of new TextDecoder().decode(result.stdout).split("\n")) {
							const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
							if (match?.[1] && match[2]) {
								samples.set(Number(match[1]), {
									cpu: null,
									hwmBytes: null,
									smapsRollup: null,
									rssBytes: Number(match[2]) * 1024,
								});
							}
						}
						return samples;
					},
				}).pipe(Effect.orElseSucceed(() => new Map<number, WorkerProcessSample>()));
			};
			const configuration = {
				processMode: config.sandbox.processMode,
				workerConcurrency: config.sandbox.workerConcurrency,
				schedulerDispatchersDisabled: config.scheduler.disableDispatchers,
				benchmarkProfilingEnabled: Option.isSome(config.sandbox.benchmarkProfileDir),
			};
			const getRuntimeMetrics = Effect.fn("SandboxProcessManager.getRuntimeMetrics")(function* (
				options: SandboxRuntimeMetricsOptions,
			) {
				const pids = Array.from(spawnedAt.keys());
				const timestampMs = yield* Clock.currentTimeMillis;
				const [samples, cgroup, backend] = yield* Effect.all([
					readWorkerMemory(pids, options.includeSmaps),
					readCgroupSample(),
					readBackendProcessSample(options.includeSmaps),
				]);
				const workers = pids.flatMap((pid) => {
					const sample = samples.get(pid);
					return sample === undefined
						? []
						: [
								{
									pid,
									rssBytes: sample.rssBytes,
									hwmBytes: sample.hwmBytes,
									smapsRollup: sample.smapsRollup,
									userCpuTicks: sample.cpu?.userTicks ?? null,
									systemCpuTicks: sample.cpu?.systemTicks ?? null,
									startTimeTicks: sample.cpu?.startTimeTicks ?? null,
								},
							];
				});
				const workerRssBytes = workers.reduce((total, worker) => total + worker.rssBytes, 0);
				const cpuTotals = workers.reduce(
					(totals, worker) => ({
						user:
							worker.userCpuTicks === null ? totals.user : (totals.user ?? 0) + worker.userCpuTicks,
						system:
							worker.systemCpuTicks === null
								? totals.system
								: (totals.system ?? 0) + worker.systemCpuTicks,
					}),
					{ user: null as number | null, system: null as number | null },
				);
				return {
					cgroup,
					workers,
					backend,
					timestampMs,
					totalSpawned,
					configuration,
					totalCompleted,
					workerRssBytes,
					completedWorkerSequence,
					runtime: sandboxRuntimeVersions,
					backendRssBytes: backend.rssBytes,
					activeProcessCount: workers.length,
					replays: getSandboxReplayCounters(),
					providerImports: providerImportMetrics(),
					completedWorkers: completedWorkers.filter(
						({ sequence }) => sequence > options.completedAfterSequence,
					),
					executions: {
						total: totalSandboxExecutions,
						active: activeSandboxExecutions,
						maxActive: maxActiveSandboxExecutions,
					},
					deno: {
						rssBytes: workerRssBytes,
						userCpuTicks: cpuTotals.user,
						processCount: workers.length,
						systemCpuTicks: cpuTotals.system,
					},
				} satisfies SandboxProcessRuntimeMetrics;
			});
			runtimeMetricsReader = getRuntimeMetrics;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					runtimeMetricsReader = emptySandboxProcessRuntimeMetrics;
				}),
			);
			yield* Effect.gen(function* () {
				yield* Effect.sleep(SANDBOX_PROCESS_GAUGE_INTERVAL);
				const metrics = yield* getRuntimeMetrics({
					includeSmaps: false,
					completedAfterSequence: completedWorkerSequence,
				});
				yield* recordSandboxRuntimeGauges({
					workerRssBytes: metrics.workerRssBytes,
					backendRssBytes: metrics.backend.rssBytes,
					activeExecutions: metrics.executions.active,
					heapUsedBytes: metrics.backend.heapUsedBytes,
					externalMemoryBytes: metrics.backend.externalBytes,
				});
			}).pipe(Effect.ignore, Effect.forever, Effect.forkScoped);
			const annotate = (worker: SandboxProcess, executionKey: string) =>
				Effect.sync(() => {
					const pid = Number(worker.process.pid);
					if (spawnedAt.has(pid)) {
						executionKeys.set(pid, executionKey);
					}
				});
			return { acquire, release, annotate, spawnDedicated, runtimePaths: dependencies };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(BridgeService.layer, RunnerFile.layer, PackageCacheManager.layer)),
	);
}
