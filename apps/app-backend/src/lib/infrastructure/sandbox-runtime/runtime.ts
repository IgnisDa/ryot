import type { CommandExecutor } from "@effect/platform";
import { Command, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { badRequest, internalError, unknownToMessage } from "@ryot/contract/errors";
import { Clock, Effect, Pool, Queue, Runtime, Schema, Stream } from "effect";

import sandboxRunnerSource from "#lib/infrastructure/sandbox-runtime/runner-source.sandbox.js" with { type: "text" };

import { AppConfig } from "../config/service";
import { redisKeys, RedisService } from "../redis";
import { ensureSandboxRuntimeDependencies } from "./dependencies";
import type { BoundHostFunction } from "./shared";

const SandboxSessionRecord = Schema.Struct({
	token: Schema.String,
	expiresAt: Schema.Number,
});

const SandboxRpcArgs = Schema.Struct({
	args: Schema.Array(Schema.Unknown),
});

const decodeSandboxRpcArgs = Schema.decodeUnknownSync(SandboxRpcArgs);
const encodeSandboxSession = Schema.encodeSync(Schema.parseJson(SandboxSessionRecord));
const decodeSandboxSession = Schema.decodeUnknownSync(Schema.parseJson(SandboxSessionRecord));

type ExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
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

const parseArgs = (request: Request) =>
	request.body
		? Effect.tryPromise({
				try: () => request.json(),
				catch: () => badRequest("Invalid request body"),
			}).pipe(
				Effect.flatMap((body) => Effect.try(() => decodeSandboxRpcArgs(body).args)),
				Effect.orElseSucceed(() => []),
			)
		: Effect.succeed([]);

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
		`--import-map=${importMapPath}`,
		`--allow-read=${runnerPath},${runtimeDirectory}`,
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
		const executionFunctions = new Map<string, Record<string, BoundHostFunction>>();

		const removeSession = Effect.fn("BridgeService.removeSession")(function* (executionId: string) {
			yield* redis.del(redisKeys.sandboxSession(executionId));
			yield* Effect.sync(() => executionFunctions.delete(executionId));
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
			yield* Effect.sync(() => executionFunctions.set(executionId, session.apiFunctions));
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

				const functions = executionFunctions.get(executionId);
				if (!functions || !Object.hasOwn(functions, fnName)) {
					return Response.json({ error: "Unknown function" }, { status: 404 });
				}

				const fn = functions[fnName];
				if (!fn) {
					return Response.json({ error: "Unknown function" }, { status: 404 });
				}

				const args = yield* parseArgs(request);
				return yield* Effect.tryPromise({
					try: () => fn(args),
					catch: (error) => internalError(unknownToMessage(error)),
				}).pipe(
					Effect.map((result) => Response.json({ result }, { status: 200 })),
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
			Effect.forEach(Array.from(executionFunctions.keys()), removeSession, { discard: true }).pipe(
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
		const path = yield* fs.makeTempFileScoped({ prefix: "ryot-sandbox-", suffix: ".mjs" });
		yield* fs.writeFileString(path, sandboxRunnerSource);
		return { path };
	}),
}) {}

export class PackageCacheManager extends Effect.Service<PackageCacheManager>()(
	"PackageCacheManager",
	{
		scoped: Effect.gen(function* () {
			const config = yield* AppConfig;
			return yield* ensureSandboxRuntimeDependencies(config.sandbox.denoDir);
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
			),
		});
	}),
}) {}
