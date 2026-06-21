import type { CommandExecutor } from "@effect/platform";
import { Command, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { badRequest, internalError, unknownToMessage } from "@ryot/contract/errors";
import { Clock, Effect, Pool, Queue, Runtime, Schema, Stream } from "effect";

import sandboxRunnerSource from "#lib/infrastructure/sandbox-runtime/runner-source.sandbox.js" with { type: "text" };
import sandboxRunnerUtilitiesSource from "#lib/infrastructure/sandbox-runtime/runner-utilities.sandbox.js" with { type: "text" };

import { sandboxDenoDirConfig } from "../config/definition";
import { AppConfig } from "../config/service";
import { redisKeys, RedisService } from "../redis";
import { ensureSandboxRuntimeDependencies } from "./dependencies";
import {
	consumeSandboxHostCall,
	SANDBOX_LIMITS,
	type SandboxHostCallBudget,
	utf8ByteLength,
} from "./limits";
import { apiFailure } from "./shared";
import type { BoundHostFunction } from "./shared";

const SandboxSessionRecord = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.Number,
});

const SandboxRpcArgs = Schema.Struct({
	args: Schema.Array(Schema.Unknown),
});

const encodeSandboxSession = Schema.encodeSync(Schema.parseJson(SandboxSessionRecord));
const decodeSandboxSession = Schema.decodeUnknownSync(Schema.parseJson(SandboxSessionRecord));
const decodeSandboxRpcBody = Schema.decode(Schema.parseJson(SandboxRpcArgs));
const encodeSandboxRpcResponse = Schema.encode(Schema.parseJson(Schema.Unknown));

const decoder = new TextDecoder();
const oversizedBridgeRequest = Symbol("oversizedBridgeRequest");

type ExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

type ActiveExecutionSession = {
	readonly budget: SandboxHostCallBudget;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

export type PooledProcess = {
	readonly process: CommandExecutor.Process;
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

	return Stream.fromReadableStream({
		evaluate: () => stream,
		onError: () => badRequest("Invalid request body"),
	}).pipe(
		Stream.runFoldEffect({ bytes: 0, chunks: [] as Uint8Array[] }, (state, chunk) => {
			const bytes = state.bytes + chunk.byteLength;
			return bytes > SANDBOX_LIMITS.bridge.requestBytes
				? Effect.fail(oversizedBridgeRequest)
				: Effect.succeed({ bytes, chunks: [...state.chunks, chunk] });
		}),
		Effect.map(({ bytes, chunks }) => {
			const body = new Uint8Array(bytes);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return { body: decoder.decode(body), oversized: false } as const;
		}),
		Effect.catchAll((error) =>
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

const killProcessHandle = (process: CommandExecutor.Process) =>
	process.kill().pipe(Effect.orElse(() => Effect.void));

const killProcess = (worker: PooledProcess) => killProcessHandle(worker.process);

export const invalidateProcess = (
	pool: Pool.Pool<PooledProcess, PlatformError>,
	worker: PooledProcess,
) => pool.invalidate(worker).pipe(Effect.zipRight(killProcess(worker)));

const makeSpawnDenoProcess = Effect.fn("makeSpawnDenoProcess")(function* (
	bridgePort: number,
	denoDir: string,
	importMapPath: string,
	runtimeDirectory: string,
	runnerPath: string,
	runnerUtilitiesPath: string,
) {
	const denoProcess = yield* Command.make(
		"deno",
		"run",
		"--deny-run",
		"--deny-env",
		"--deny-ffi",
		"--deny-write",
		"--no-prompt",
		"--no-config",
		"--no-lock",
		"--no-npm",
		"--no-remote",
		"--cached-only",
		`--v8-flags=--max-old-space-size=${SANDBOX_LIMITS.execution.denoHeapMiB}`,
		`--import-map=${importMapPath}`,
		`--allow-read=${runnerPath},${runnerUtilitiesPath},${runtimeDirectory}`,
		`--allow-net=127.0.0.1:${bridgePort}`,
		runnerPath,
	).pipe(
		Command.stdin("pipe"),
		Command.stdout("pipe"),
		Command.stderr("pipe"),
		Command.env({ DENO_DIR: denoDir }),
		Command.start,
	);

	yield* Effect.addFinalizer(() => killProcessHandle(denoProcess));

	const responseQueue = yield* Queue.unbounded<string>();
	const stdinQueue = yield* Queue.unbounded<Uint8Array>();

	yield* Stream.fromQueue(stdinQueue).pipe(Stream.run(denoProcess.stdin), Effect.forkScoped);

	yield* denoProcess.stdout.pipe(
		Stream.decodeText("utf-8"),
		Stream.splitLines,
		Stream.runForEach((line) => responseQueue.offer(line).pipe(Effect.asVoid)),
		Effect.forkScoped,
	);

	yield* denoProcess.stderr.pipe(
		Stream.decodeText("utf-8"),
		Stream.splitLines,
		Stream.runForEach(() => Effect.void),
		Effect.forkScoped,
	);

	return { process: denoProcess, stdinQueue, responseQueue };
});

export class BridgeService extends Effect.Service<BridgeService>()("BridgeService", {
	scoped: Effect.gen(function* () {
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime();
		const activeSessions = new Map<string, ActiveExecutionSession>();

		const removeSession = Effect.fn("BridgeService.removeSession")(function* (executionId: string) {
			yield* redis.del(redisKeys.sandboxSession(executionId));
			yield* Effect.sync(() => activeSessions.delete(executionId));
		}, Effect.asVoid);

		const addSession = Effect.fn("BridgeService.addSession")(function* (
			executionId: string,
			session: ExecutionSession,
		) {
			const now = yield* Clock.currentTimeMillis;
			const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
			yield* redis.set(
				redisKeys.sandboxSession(executionId),
				encodeSandboxSession({ expiresAt: session.expiresAt, token: session.token }),
				ttlSeconds,
			);
			yield* Effect.sync(() =>
				activeSessions.set(executionId, {
					budget: { http: 0, total: 0 },
					apiFunctions: session.apiFunctions,
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
				const budgetError = consumeSandboxHostCall(activeSession.budget, fnName);
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
				return yield* Effect.tryPromise({
					try: () => fn(args),
					catch: (error) => internalError(unknownToMessage(error)),
				}).pipe(
					Effect.flatMap(sandboxBridgeResultResponse),
					Effect.catchAll((error) =>
						Effect.succeed(Response.json({ error: unknownToMessage(error) }, { status: 500 })),
					),
				);
			},
			Effect.catchAll((error) =>
				Effect.succeed(Response.json({ error: unknownToMessage(error) }, { status: 400 })),
			),
		);

		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) => Runtime.runPromise(runtime)(handleRequest(request)),
		});

		yield* Effect.addFinalizer(() =>
			Effect.forEach(Array.from(activeSessions.keys()), removeSession, { discard: true }).pipe(
				Effect.zipRight(Effect.promise(() => server.stop(true))),
				Effect.orDie,
			),
		);

		return { addSession, removeSession, port: server.port ?? 0 };
	}),
}) {}

class RunnerFile extends Effect.Service<RunnerFile>()("RunnerFile", {
	scoped: Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-runner-" });
		const path = `${directory}/runner-source.sandbox.js`;
		const utilitiesPath = `${directory}/runner-utilities.sandbox.js`;
		yield* fs.writeFileString(path, sandboxRunnerSource);
		yield* fs.writeFileString(utilitiesPath, sandboxRunnerUtilitiesSource);
		return { path, utilitiesPath };
	}),
}) {}

export class PackageCacheManager extends Effect.Service<PackageCacheManager>()(
	"PackageCacheManager",
	{
		scoped: Effect.gen(function* () {
			const denoDir = yield* sandboxDenoDirConfig;
			return yield* ensureSandboxRuntimeDependencies(denoDir);
		}),
	},
) {}

export class ProcessPool extends Effect.Service<ProcessPool>()("ProcessPool", {
	dependencies: [BridgeService.Default, RunnerFile.Default, PackageCacheManager.Default],
	scoped: Effect.gen(function* () {
		const config = yield* AppConfig;
		const runner = yield* RunnerFile;
		const bridge = yield* BridgeService;
		const dependencies = yield* PackageCacheManager;
		return yield* Pool.make({
			size: config.sandbox.workerConcurrency + 2,
			acquire: makeSpawnDenoProcess(
				bridge.port,
				dependencies.cacheDirectory,
				dependencies.importMapPath,
				dependencies.directory,
				runner.path,
				runner.utilitiesPath,
			),
		});
	}),
}) {}
