import type { CommandExecutor } from "@effect/platform";
import { Command, FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Context, Duration, Effect, Layer, Pool, Queue, Runtime, Stream } from "effect";

import { getBuiltinSandboxScript } from "./builtin-scripts";
import { AppConfig } from "./config";
import { SandboxRunError, TimeoutError, unknownToMessage } from "./errors";
import { redisKeys, RedisService } from "./redis";
import { sandboxRunnerSource } from "./sandbox-runner-source";

export type SandboxRunInput = {
	readonly context: unknown;
	readonly runId: string | null;
	readonly driverName: string;
	readonly scriptSlug: string;
	readonly executionId: string;
};

export type SandboxRunOutput = {
	readonly logs: string | null;
	readonly value: unknown;
	readonly error: string | null;
	readonly success: boolean;
	readonly executionId: string;
};

type BoundHostFunction = (...args: ReadonlyArray<unknown>) => Promise<unknown>;

type ExecutionSession = {
	readonly token: string;
	readonly expiresAt: number;
	readonly apiFunctions: Record<string, BoundHostFunction>;
};

type PooledProcess = {
	readonly process: CommandExecutor.Process;
	readonly stdinQueue: Queue.Queue<Uint8Array>;
	readonly responseQueue: Queue.Queue<string>;
};

type SandboxSessionRecord = {
	readonly token: string;
	readonly expiresAt: number;
};

type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

const sessionTtlBufferMs = 2_000;
const invalidResponseMessage = "Invalid JSON response from Deno process";
const httpCallTimeoutMs = 8_000;
const defaultHeaders = {
	"User-Agent": "Ryot Reference ( https://github.com/ignisda/ryot )",
} satisfies Record<string, string>;

export class BridgeService extends Context.Tag("BridgeService")<
	BridgeService,
	{
		readonly port: number;
		readonly addSession: (executionId: string, session: ExecutionSession) => Effect.Effect<void>;
		readonly removeSession: (executionId: string) => Effect.Effect<void>;
	}
>() {}

export class RunnerFile extends Context.Tag("RunnerFile")<
	RunnerFile,
	{ readonly path: string }
>() {}

export class ProcessPool extends Context.Tag("ProcessPool")<
	ProcessPool,
	Pool.Pool<PooledProcess, PlatformError>
>() {}

export class SandboxService extends Context.Tag("SandboxService")<
	SandboxService,
	{
		readonly run: (
			input: SandboxRunInput,
		) => Effect.Effect<SandboxRunOutput, SandboxRunError | TimeoutError>;
	}
>() {}

const parseSandboxSession = (raw: string): SandboxSessionRecord => {
	const parsed = JSON.parse(raw);
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		typeof parsed.token !== "string" ||
		typeof parsed.expiresAt !== "number"
	) {
		throw new Error("Sandbox session is invalid");
	}
	return parsed;
};

const parseArgs = async (request: Request) => {
	if (!request.body) {
		return [] as Array<unknown>;
	}
	const body = await request.json();
	return body !== null && typeof body === "object" && "args" in body && Array.isArray(body.args)
		? body.args
		: [];
};

const makeInvalidResponse = () => new SandboxRunError({ message: invalidResponseMessage });

const parseHttpCallOptions = (options: unknown): HttpCallOptions => {
	if (options === undefined || options === null) {
		return {};
	}
	if (typeof options !== "object" || Array.isArray(options)) {
		throw new Error("httpCall options must be an object");
	}

	const parsed: HttpCallOptions = {};
	const body = Reflect.get(options, "body");
	const headersValue = Reflect.get(options, "headers");

	if (body !== undefined) {
		if (typeof body === "string") {
			parsed.body = body;
		} else {
			throw new Error("httpCall options.body must be a string");
		}
	}

	if (headersValue !== undefined) {
		if (typeof headersValue === "object" && !Array.isArray(headersValue) && headersValue !== null) {
			const headers: Record<string, string> = {};
			for (const [key, value] of Object.entries(headersValue)) {
				if (typeof value !== "string") {
					throw new Error("httpCall headers must be string values");
				}
				headers[key] = value;
			}
			parsed.headers = headers;
		} else {
			throw new Error("httpCall options.headers must be an object");
		}
	}

	return parsed;
};

const mapHeadersToObject = (headers: Headers) => {
	const headerObject: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		headerObject[key] = value;
	}
	return headerObject;
};

const killProcessHandle = (process: CommandExecutor.Process) =>
	process.kill().pipe(Effect.orElse(() => Effect.void));

const killProcess = (worker: PooledProcess) => killProcessHandle(worker.process);

const invalidateProcess = (pool: Pool.Pool<PooledProcess, PlatformError>, worker: PooledProcess) =>
	pool.invalidate(worker).pipe(Effect.zipRight(killProcess(worker)));

const makeSpawnDenoProcess = (bridgePort: number, denoDir: string, runnerPath: string) =>
	Effect.gen(function* () {
		const denoProcess = yield* Command.make(
			"deno",
			"run",
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

		const stdinQueue = yield* Queue.unbounded<Uint8Array>();
		const responseQueue = yield* Queue.unbounded<string>();

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

export const RunnerFileLive = Layer.scoped(
	RunnerFile,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* fs.makeTempFileScoped({
			prefix: "ryot-reference-sandbox-",
			suffix: ".mjs",
		});
		yield* fs.writeFileString(path, sandboxRunnerSource);
		return { path };
	}),
);

export const BridgeServerLive = Layer.scoped(
	BridgeService,
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime();
		const executionFunctions = new Map<string, Record<string, BoundHostFunction>>();

		const removeSession = (executionId: string) =>
			Effect.gen(function* () {
				yield* redis.del(redisKeys.sandboxSession(executionId));
				yield* Effect.sync(() => executionFunctions.delete(executionId));
			}).pipe(Effect.asVoid);

		const addSession = (executionId: string, session: ExecutionSession) =>
			Effect.gen(function* () {
				const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
				yield* redis.set(
					redisKeys.sandboxSession(executionId),
					JSON.stringify({ expiresAt: session.expiresAt, token: session.token }),
					ttlSeconds,
				);
				yield* Effect.sync(() => executionFunctions.set(executionId, session.apiFunctions));
			});

		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				try {
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
					const sessionValue = await Runtime.runPromise(runtime)(
						redis.get(redisKeys.sandboxSession(executionId)),
					);
					if (!sessionValue) {
						return Response.json({ error: "Execution not found" }, { status: 404 });
					}

					const session = parseSandboxSession(sessionValue);
					if (Date.now() > session.expiresAt) {
						await Runtime.runPromise(runtime)(removeSession(executionId));
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

					const args = await parseArgs(request);
					try {
						const result = await fn(...args);
						return Response.json({ result }, { status: 200 });
					} catch (error) {
						return Response.json({ error: unknownToMessage(error) }, { status: 500 });
					}
				} catch (error) {
					return Response.json({ error: unknownToMessage(error) }, { status: 400 });
				}
			},
		});

		yield* Effect.addFinalizer(() =>
			Effect.forEach(Array.from(executionFunctions.keys()), removeSession, { discard: true }).pipe(
				Effect.zipRight(Effect.promise(() => server.stop(true))),
				Effect.orDie,
			),
		);

		return {
			addSession,
			removeSession,
			port: server.port ?? 0,
		};
	}),
);

export const ProcessPoolLive = Layer.scoped(
	ProcessPool,
	Effect.gen(function* () {
		const bridge = yield* BridgeService;
		const config = yield* AppConfig;
		const runner = yield* RunnerFile;
		return yield* Pool.make({
			acquire: makeSpawnDenoProcess(bridge.port, config.sandbox.denoDir, runner.path),
			size: 5,
		});
	}),
);

export const SandboxLive = Layer.effect(
	SandboxService,
	Effect.gen(function* () {
		const bridge = yield* BridgeService;
		const config = yield* AppConfig;
		const pool = yield* ProcessPool;
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime();
		const runPromise = Runtime.runPromise(runtime);
		const apiFunctions = {
			getCachedValue: async (key: unknown) => {
				if (typeof key !== "string" || !key.trim()) {
					throw new Error("getCachedValue expects a non-empty key string");
				}
				return await runPromise(redis.get(key.trim()));
			},
			httpCall: async (method: unknown, url: unknown, options?: unknown) => {
				if (typeof method !== "string" || !method.trim()) {
					return { error: "httpCall expects a non-empty method string", success: false };
				}
				if (typeof url !== "string" || !url.trim()) {
					return { error: "httpCall expects a non-empty URL string", success: false };
				}

				let requestUrl: URL;
				try {
					requestUrl = new URL(url);
				} catch {
					return { error: "httpCall URL is invalid", success: false };
				}

				let parsedOptions: HttpCallOptions;
				try {
					parsedOptions = parseHttpCallOptions(options);
				} catch (error) {
					return { error: unknownToMessage(error), success: false };
				}

				try {
					const response = await fetch(requestUrl.toString(), {
						body: parsedOptions.body,
						method: method.trim().toUpperCase(),
						headers: { ...defaultHeaders, ...parsedOptions.headers },
						signal: AbortSignal.timeout(httpCallTimeoutMs),
					});

					const responseBody = await response.text();
					if (!response.ok) {
						return {
							error: `HTTP ${response.status} ${response.statusText}`,
							success: false,
							data: { status: response.status },
						};
					}

					return {
						success: true,
						data: {
							body: responseBody,
							status: response.status,
							statusText: response.statusText,
							headers: mapHeadersToObject(response.headers),
						},
					};
				} catch (error) {
					return { error: unknownToMessage(error), success: false };
				}
			},
			setCachedValue: async (key: unknown, value: unknown, ttlSeconds?: unknown) => {
				if (typeof key !== "string" || !key.trim()) {
					throw new Error("setCachedValue expects a non-empty key string");
				}
				if (typeof value !== "string") {
					throw new Error("setCachedValue expects a string value");
				}

				const ttl =
					typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
						? Math.max(1, Math.floor(ttlSeconds))
						: undefined;
				await runPromise(redis.set(key.trim(), value, ttl));
				return true;
			},
		} satisfies Record<string, BoundHostFunction>;

		return {
			run: (input) =>
				Effect.scoped(
					Effect.gen(function* () {
						const script = getBuiltinSandboxScript(input.scriptSlug);
						if (!script) {
							return yield* new SandboxRunError({
								message: `Unknown sandbox script ${input.scriptSlug}`,
							});
						}

						const selectedApiFunctions = Object.fromEntries(
							script.allowedHostFunctions.map((key) => [key, apiFunctions[key]]),
						);
						const worker = yield* pool.get;
						yield* worker.responseQueue.takeAll.pipe(Effect.asVoid);

						const token = crypto.randomUUID();
						yield* bridge.addSession(input.executionId, {
							apiFunctions: selectedApiFunctions,
							expiresAt: Date.now() + config.sandbox.timeoutMs + sessionTtlBufferMs,
							token,
						});
						yield* Effect.addFinalizer(() =>
							bridge.removeSession(input.executionId).pipe(Effect.orDie),
						);

						const requestLine =
							JSON.stringify({
								apiBase: `http://127.0.0.1:${bridge.port}`,
								apiFunctions: Object.keys(selectedApiFunctions),
								code: script.code,
								context: input.context ?? {},
								driverName: input.driverName,
								executionId: input.executionId,
								scriptSlug: input.scriptSlug,
								token,
							}) + "\n";

						yield* worker.stdinQueue.offer(new TextEncoder().encode(requestLine));

						const responseLine = yield* Effect.raceFirst(
							worker.responseQueue.take,
							Effect.sleep(Duration.millis(config.sandbox.timeoutMs)).pipe(
								Effect.zipRight(invalidateProcess(pool, worker)),
								Effect.zipRight(
									Effect.fail(
										new TimeoutError({
											message: `Sandbox timed out after ${config.sandbox.timeoutMs}ms`,
										}),
									),
								),
							),
						);

						const raw = yield* Effect.try({
							try: () => JSON.parse(responseLine),
							catch: makeInvalidResponse,
						}).pipe(
							Effect.catchAll((error) =>
								invalidateProcess(pool, worker).pipe(Effect.zipRight(Effect.fail(error))),
							),
						);

						if (raw === null || typeof raw !== "object" || typeof raw.success !== "boolean") {
							return yield* invalidateProcess(pool, worker).pipe(
								Effect.zipRight(Effect.fail(makeInvalidResponse())),
							);
						}

						const error = "error" in raw && typeof raw.error === "string" ? raw.error : null;
						const logs = "logs" in raw && typeof raw.logs === "string" ? raw.logs : null;

						return {
							error,
							executionId: input.executionId,
							logs,
							success: raw.success,
							value: raw.success && "value" in raw ? raw.value : null,
						};
					}),
				).pipe(
					Effect.mapError((error) =>
						error instanceof TimeoutError || error instanceof SandboxRunError
							? error
							: new SandboxRunError({ message: unknownToMessage(error) }),
					),
				),
		};
	}),
).pipe(
	Layer.provide(ProcessPoolLive),
	Layer.provide(RunnerFileLive),
	Layer.provide(BridgeServerLive),
);
