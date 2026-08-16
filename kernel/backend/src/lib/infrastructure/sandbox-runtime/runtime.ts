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
import { materializeShippedSandboxRuntime } from "./dependencies";
import type { SandboxProcessGrants } from "./filesystem-grants";
import { consumeSandboxHostCall, SANDBOX_LIMITS, type SandboxHostCallBudget } from "./limits";
import { sandboxRunnerSource } from "./runner.generated";
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

type ExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
	readonly hostCallLimit: number;
	readonly parentSpan: Tracer.AnySpan;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

type ActiveExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
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
	readonly stderrTail: SandboxStderrTail;
	readonly responseQueue: Queue.Queue<string>;
	readonly stdinQueue: Queue.Queue<Uint8Array>;
	readonly stderrClosed: Deferred.Deferred<void>;
	readonly process: ChildProcessSpawner.ChildProcessHandle;
};

export type SandboxProcessRuntimeMetrics = {
	readonly totalSpawned: number;
	readonly workerRssBytes: number;
	readonly totalCompleted: number;
	readonly backendRssBytes: number;
	readonly activeProcessCount: number;
	readonly workers: ReadonlyArray<{ readonly pid: number; readonly rssBytes: number }>;
};

class SandboxProcessMemoryReadError extends Data.TaggedError("SandboxProcessMemoryReadError")<{}> {}

const emptySandboxProcessRuntimeMetrics = (): SandboxProcessRuntimeMetrics => ({
	workers: [],
	totalSpawned: 0,
	totalCompleted: 0,
	workerRssBytes: 0,
	activeProcessCount: 0,
	backendRssBytes: process.memoryUsage().rss,
});

let runtimeMetricsReader: () => Effect.Effect<SandboxProcessRuntimeMetrics> = () =>
	Effect.succeed(emptySandboxProcessRuntimeMetrics());

export const getSandboxRuntimeMetrics = Effect.suspend(() => runtimeMetricsReader());

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
		Effect.catch((error) =>
			error === oversizedBridgeRequest
				? Effect.succeed({ body: "", oversized: true } as const)
				: Effect.fail(error),
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
	);

export const withSandboxHostCallPermit = <A, E, R>(
	semaphore: Semaphore.Semaphore,
	effect: Effect.Effect<A, E, R>,
) => semaphore.withPermits(1)(effect);

const killProcessHandle = (process: ChildProcessSpawner.ChildProcessHandle) =>
	process.kill().pipe(Effect.ignore);

type SpawnDenoProcessOptions = {
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

const makeSpawnDenoProcess = Effect.fn("makeSpawnDenoProcess")(function* (
	options: SpawnDenoProcessOptions,
) {
	const path = Bun.env["PATH"];
	if (!path) {
		return yield* Effect.die(new Error("Sandbox process PATH is unavailable"));
	}
	const denoProcess = yield* ChildProcess.make(
		"deno",
		["run", ...sandboxDenoRunFlags(options), options.runnerPath],
		{
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			extendEnv: false,
			env: { PATH: path, DENO_DIR: options.denoDir },
		},
	);

	yield* Effect.addFinalizer(() => killProcessHandle(denoProcess));

	const responseQueue = yield* Queue.unbounded<string>();
	const stdinQueue = yield* Queue.unbounded<Uint8Array>();
	const stderrClosed = yield* Deferred.make<void>();
	const stderrTail = makeSandboxStderrTail();

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
		Stream.runForEach((line) => Effect.sync(() => stderrTail.append(line))),
		Effect.ensuring(Deferred.succeed(stderrClosed, undefined)),
		Effect.forkScoped,
	);

	return { stdinQueue, stderrTail, stderrClosed, responseQueue, process: denoProcess };
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
			};
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					closeSession(activeSessions.get(executionId));
					activeSessions.set(executionId, active);
				}),
				() => Effect.sync(() => evictSession(executionId, active)),
			);
		});

		const handleRequest = Effect.fn("BridgeService.handleRequest")(
			function* (request: Request) {
				if (request.method !== "POST") {
					return Response.json({ error: "Not found" }, { status: 404 });
				}

				const url = new URL(request.url);
				const parts = url.pathname.split("/").filter(Boolean);
				if (parts.length !== 3 || parts[0] !== "rpc") {
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
			const spawn = (grants?: SandboxProcessGrants) =>
				makeSpawnDenoProcess({
					bridgePort: bridge.port,
					runnerPath: runner.path,
					...(grants ? { grants } : {}),
					denoDir: dependencies.cacheDirectory,
					runtimeDirectory: dependencies.directory,
					importMapPath: dependencies.importMapPath,
				}).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
			const states = new Set<number>();
			let totalSpawned = 0;
			let totalCompleted = 0;
			const track = (worker: SandboxProcess) => {
				const pid = Number(worker.process.pid);
				if (Number.isSafeInteger(pid) && pid > 0) {
					states.add(pid);
					totalSpawned += 1;
				}
			};
			const finish = (worker: SandboxProcess) => {
				const pid = Number(worker.process.pid);
				if (states.delete(pid)) {
					totalCompleted += 1;
				}
			};
			const spawnTracked = (grants?: SandboxProcessGrants) =>
				spawn(grants).pipe(Effect.tap((worker) => Effect.sync(() => track(worker))));
			const pool =
				config.sandbox.processMode === "warm"
					? yield* Pool.make({
							acquire: spawnTracked(),
							size: SANDBOX_LIMITS.workerConcurrency + 2,
						})
					: undefined;
			const acquire = pool === undefined ? spawnTracked() : Pool.get(pool);
			const release = (worker: SandboxProcess) =>
				Effect.sync(() => finish(worker)).pipe(
					Effect.andThen(pool === undefined ? Effect.void : Pool.invalidate(pool, worker)),
					Effect.andThen(killProcessHandle(worker.process)),
				);
			const spawnDedicated = (grants?: SandboxProcessGrants) =>
				spawnTracked(grants).pipe(
					Effect.tap((worker) => Effect.addFinalizer(() => Effect.sync(() => finish(worker)))),
				);
			const readWorkerMemory = (pids: ReadonlyArray<number>) => {
				if (process.platform === "linux") {
					return Effect.forEach(
						pids,
						(pid) =>
							Effect.tryPromise({
								catch: () => new SandboxProcessMemoryReadError(),
								try: () => Bun.file(`/proc/${pid}/status`).text(),
							}).pipe(
								Effect.map((status) => {
									const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
									return match?.[1] ? ([pid, Number(match[1]) * 1024] as const) : null;
								}),
								Effect.orElseSucceed(() => null),
							),
						{ concurrency: "unbounded" },
					).pipe(
						Effect.map(
							(entries) => new Map(entries.flatMap((entry) => (entry === null ? [] : [entry]))),
						),
					);
				}
				return Effect.try({
					catch: () => new SandboxProcessMemoryReadError(),
					try: () => {
						if (pids.length === 0) {
							return new Map<number, number>();
						}
						const result = Bun.spawnSync(["ps", "-o", "pid=,rss=", "-p", pids.join(",")]);
						if (result.exitCode !== 0) {
							return new Map<number, number>();
						}
						const memory = new Map<number, number>();
						for (const line of new TextDecoder().decode(result.stdout).split("\n")) {
							const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
							if (match?.[1] && match[2]) {
								memory.set(Number(match[1]), Number(match[2]) * 1024);
							}
						}
						return memory;
					},
				}).pipe(Effect.orElseSucceed(() => new Map<number, number>()));
			};
			const getRuntimeMetrics = Effect.fn("SandboxProcessManager.getRuntimeMetrics")(function* () {
				const pids = Array.from(states);
				const memory = yield* readWorkerMemory(pids);
				const workers = pids.map((pid) => ({ pid, rssBytes: memory.get(pid) ?? 0 }));
				return {
					workers,
					totalSpawned,
					totalCompleted,
					activeProcessCount: workers.length,
					backendRssBytes: process.memoryUsage().rss,
					workerRssBytes: workers.reduce((total, worker) => total + worker.rssBytes, 0),
				};
			});
			runtimeMetricsReader = getRuntimeMetrics;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					runtimeMetricsReader = () => Effect.succeed(emptySandboxProcessRuntimeMetrics());
				}),
			);
			return { acquire, release, spawnDedicated, runtimePaths: dependencies };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(BridgeService.layer, RunnerFile.layer, PackageCacheManager.layer)),
	);
}
