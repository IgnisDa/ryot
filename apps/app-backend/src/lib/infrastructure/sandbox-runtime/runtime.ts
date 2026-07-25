import { BunHttpServer } from "@effect/platform-bun";
import { badRequest, internalError, unknownToMessage } from "@ryot/contract/errors";
import {
	Clock,
	Context,
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
import type { PlatformError } from "effect/PlatformError";
import { HttpEffect, HttpServer } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { sandboxDenoDirConfig } from "../config/definition";
import { redisKeys, RedisService } from "../redis";
import { ensureSandboxRuntimeDependencies } from "./dependencies";
import type { SandboxProcessGrants } from "./filesystem-grants";
import {
	consumeSandboxHostCall,
	SANDBOX_LIMITS,
	type SandboxHostCallBudget,
	utf8ByteLength,
} from "./limits";
import { sandboxRunnerSource } from "./runner.generated";
import { apiFailure } from "./shared";
import type { BoundHostFunction } from "./shared";
import { readSandboxByteLimitedStream } from "./stream-utils";

const SandboxSessionRecord = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.Finite,
});

const SandboxRpcArgs = Schema.Struct({
	args: Schema.Array(Schema.Unknown),
});

const encodeSandboxSession = Schema.encodeSync(Schema.fromJsonString(SandboxSessionRecord));
const decodeSandboxSession = Schema.decodeUnknownSync(Schema.fromJsonString(SandboxSessionRecord));
const decodeSandboxRpcBody = Schema.decodeUnknownEffect(Schema.fromJsonString(SandboxRpcArgs));
const encodeSandboxRpcResponse = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const decoder = new TextDecoder();
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
	readonly hostCallLimit: number;
	readonly parentSpan: Tracer.AnySpan;
	readonly semaphore: Semaphore.Semaphore;
	readonly budget: SandboxHostCallBudget;
	readonly closed: Deferred.Deferred<void>;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

type PooledProcess = {
	readonly process: ChildProcessSpawner.ChildProcessHandle;
	readonly responseQueue: Queue.Queue<string>;
	readonly stdinQueue: Queue.Queue<Uint8Array>;
};

type SandboxSessionRecord = {
	readonly token: string;
	readonly expiresAt: number;
};

const parseSandboxSession = (raw: string) => decodeSandboxSession(raw);

export const readSandboxBridgeRequestBody = (request: Request) => {
	const stream = request.body;
	if (!stream) {
		return Effect.succeed({ body: "", oversized: false } as const);
	}

	return readSandboxByteLimitedStream(
		Stream.fromReadableStream({
			evaluate: () => stream,
			onError: () => badRequest("Invalid request body"),
		}),
		SANDBOX_LIMITS.bridge.requestBytes,
		oversizedBridgeRequest,
	).pipe(
		Effect.map((body) => ({ body: decoder.decode(body), oversized: false }) as const),
		Effect.catch((error) =>
			error === oversizedBridgeRequest
				? Effect.succeed({ body: "", oversized: true } as const)
				: Effect.fail(error),
		),
	);
};

const hostFailureResponse = (message: string) =>
	Response.json({ result: apiFailure(message) }, { status: 200 });

export const sandboxBridgeResultResponse = (result: unknown) =>
	encodeSandboxRpcResponse({ result }).pipe(
		Effect.map((body) =>
			utf8ByteLength(body) > SANDBOX_LIMITS.bridge.responseBytes
				? hostFailureResponse(
						`Sandbox bridge response exceeds ${SANDBOX_LIMITS.bridge.responseBytes} UTF-8 bytes`,
					)
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
			attributes: { executionId: input.executionId, functionName: input.fnName },
		}),
		Effect.withParentSpan(input.parentSpan),
	);

export const withSandboxHostCallPermit = <A, E, R>(
	semaphore: Semaphore.Semaphore,
	effect: Effect.Effect<A, E, R>,
) => semaphore.withPermits(1)(effect);

const killProcessHandle = (process: ChildProcessSpawner.ChildProcessHandle) =>
	process.kill().pipe(Effect.ignore);

const killProcess = (worker: PooledProcess) => killProcessHandle(worker.process);

export const invalidateProcess = (
	pool: Pool.Pool<PooledProcess, PlatformError>,
	worker: PooledProcess,
) => Pool.invalidate(pool, worker).pipe(Effect.andThen(killProcess(worker)));

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
		Stream.runForEach(() => Effect.void),
		Effect.forkScoped,
	);

	return { process: denoProcess, stdinQueue, responseQueue };
});

export class BridgeService extends Context.Service<BridgeService>()("BridgeService", {
	make: Effect.gen(function* () {
		const redis = yield* RedisService;
		const runtime = yield* Effect.context();
		const activeSessions = new Map<string, ActiveExecutionSession>();

		const removeSession = Effect.fn("BridgeService.removeSession")(function* (executionId: string) {
			yield* Effect.sync(() => {
				const session = activeSessions.get(executionId);
				activeSessions.delete(executionId);
				if (session) {
					Deferred.doneUnsafe(session.closed, Effect.void);
				}
			});
			yield* redis.del(redisKeys.sandboxSession(executionId));
		}, Effect.asVoid);

		const addSession = Effect.fn("BridgeService.addSession")(function* (
			executionId: string,
			session: ExecutionSession,
		) {
			const now = yield* Clock.currentTimeMillis;
			const closed = yield* Deferred.make<void>();
			const semaphore = yield* Semaphore.make(SANDBOX_LIMITS.bridge.concurrentHostCalls);
			const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
			yield* redis.set(
				redisKeys.sandboxSession(executionId),
				encodeSandboxSession({ expiresAt: session.expiresAt, token: session.token }),
				ttlSeconds,
			);
			yield* Effect.sync(() =>
				activeSessions.set(executionId, {
					closed,
					budget: { http: 0, total: 0 },
					semaphore,
					parentSpan: session.parentSpan,
					apiFunctions: session.apiFunctions,
					hostCallLimit: session.hostCallLimit,
				}),
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
				const sessionValue = yield* redis.get(redisKeys.sandboxSession(executionId));
				if (!sessionValue) {
					return Response.json({ error: "Execution not found" }, { status: 404 });
				}

				const session = yield* Effect.try({
					try: () => parseSandboxSession(sessionValue),
					catch: () => badRequest("Sandbox session is invalid"),
				});
				const now = yield* Clock.currentTimeMillis;
				if (now > session.expiresAt) {
					yield* removeSession(executionId);
					return Response.json({ error: "Execution expired" }, { status: 410 });
				}

				const authHeader = request.headers.get("authorization");
				if (authHeader !== `Bearer ${session.token}`) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const activeSession = activeSessions.get(executionId);
				if (!activeSession) {
					return Response.json({ error: "Execution not found" }, { status: 404 });
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
					Effect.flatMap(sandboxBridgeResultResponse),
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

		const server = yield* BunHttpServer.make({
			port: 0,
			hostname: "127.0.0.1",
		});
		yield* HttpServer.serveEffect(
			HttpEffect.fromWebHandler((request) =>
				Effect.runPromiseWith(runtime)(handleRequest(request)),
			),
		).pipe(Effect.provideService(HttpServer.HttpServer, server));
		const address = server.address;
		if (address._tag === "UnixAddress") {
			return yield* Effect.die("Sandbox bridge unexpectedly bound to a Unix socket");
		}

		yield* Effect.addFinalizer(() =>
			Effect.forEach(Array.from(activeSessions.keys()), removeSession, { discard: true }).pipe(
				Effect.orDie,
			),
		);

		return { addSession, removeSession, port: address.port };
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
			return yield* ensureSandboxRuntimeDependencies(denoDir);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class ProcessPool extends Context.Service<ProcessPool>()("ProcessPool", {
	make: Effect.gen(function* () {
		const runner = yield* RunnerFile;
		const bridge = yield* BridgeService;
		const dependencies = yield* PackageCacheManager;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		// The executor is captured here so a dedicated spawn does not leak a context requirement into
		// every caller of `SandboxService.run`.
		const spawn = (grants?: SandboxProcessGrants) =>
			makeSpawnDenoProcess({
				bridgePort: bridge.port,
				runnerPath: runner.path,
				denoDir: dependencies.cacheDirectory,
				runtimeDirectory: dependencies.directory,
				importMapPath: dependencies.importMapPath,
				...(grants ? { grants } : {}),
			}).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
		const pool = yield* Pool.make({ acquire: spawn(), size: SANDBOX_LIMITS.workerConcurrency + 2 });
		return { pool, runtimePaths: dependencies, spawnDedicated: spawn };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(BridgeService.layer, RunnerFile.layer, PackageCacheManager.layer)),
	);
}
