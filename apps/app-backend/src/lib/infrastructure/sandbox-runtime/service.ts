import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { isHttpMethod } from "@effect/platform/HttpMethod";
import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { Clock, Duration, Effect, Match, Runtime, Schema } from "effect";

import { AppConfig } from "../config/service";
import { redisKeys, RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { makeAdditionalSandboxApiFunctions } from "./host-functions";
import { BridgeService, invalidateProcess, ProcessPool } from "./runtime";
import { apiFailure, apiSuccess, type BoundHostFunction, requireSandboxRunInput } from "./shared";

type HttpCallOptions = { body?: string; headers?: Record<string, string> };

export type SandboxRunInput = {
	readonly context: unknown;
	readonly scriptId: string;
	readonly metadata: unknown;
	readonly driverName: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly userId: string | null;
	readonly compiledFormat: number;
	readonly scriptIsBuiltin: boolean;
	readonly allowedHostFunctions: readonly string[];
};

export type SandboxRunOutput = {
	readonly logs: string[];
	readonly value: unknown;
	readonly success: boolean;
	readonly executionId: string;
	readonly error: string | null;
	readonly timing: { readonly totalMs: number; readonly executionMs: number };
};

const httpCallTimeoutMs = 8_000;
const sessionTtlBufferMs = 2_000;
const invalidResponseMessage = "Invalid JSON response from Deno process";
const defaultHeaders = { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" };
const getCacheKey = (serverRunId: string, scriptId: string, key: string) =>
	redisKeys.sandboxRunCache(serverRunId, scriptId, key);

const SandboxRunnerRequest = Schema.Struct({
	token: Schema.String,
	apiBase: Schema.String,
	context: Schema.Unknown,
	scriptId: Schema.String,
	metadata: Schema.Unknown,
	driverName: Schema.String,
	executionId: Schema.String,
	compiledCode: Schema.String,
	compiledFormat: Schema.Number,
	apiFunctions: Schema.Array(Schema.String),
});

const SandboxRunnerResponse = Schema.Struct({
	success: Schema.Boolean,
	value: Schema.optional(Schema.Unknown),
	logs: Schema.optional(Schema.Array(Schema.String)),
	error: Schema.optional(Schema.NullOr(Schema.String)),
	timing: Schema.optional(Schema.Struct({ executionMs: Schema.Number })),
});

const encodeSandboxRunnerRequest = Schema.encodeSync(Schema.parseJson(SandboxRunnerRequest));
const decodeSandboxRunnerResponse = Schema.decodeUnknownSync(
	Schema.parseJson(SandboxRunnerResponse),
);

const makeInvalidResponse = () => new SandboxRunError({ message: invalidResponseMessage });

const parseHttpCallOptions = (options: unknown) => {
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
		if (typeof body !== "string") {
			throw new Error("httpCall options.body must be a string");
		}
		parsed.body = body;
	}

	if (headersValue !== undefined) {
		if (typeof headersValue !== "object" || Array.isArray(headersValue) || headersValue === null) {
			throw new Error("httpCall options.headers must be an object");
		}
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(headersValue)) {
			if (typeof value !== "string") {
				throw new Error("httpCall headers must be string values");
			}
			headers[key] = value;
		}
		parsed.headers = headers;
	}

	return parsed;
};

export class SandboxService extends Effect.Service<SandboxService>()("SandboxService", {
	dependencies: [FetchHttpClient.layer, ProcessPool.Default, BridgeService.Default],
	effect: Effect.gen(function* () {
		const pool = yield* ProcessPool;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const bridge = yield* BridgeService;

		const runtime = yield* Effect.runtime();
		const runPromise = Runtime.runPromise(runtime);
		const httpClient = yield* HttpClient.HttpClient;

		// `runSandbox` reads `apiFunctions`, and some host functions are built from `runSandbox`
		// (a trigger script can itself create events, which runs further before-create triggers).
		// The late `let` binding ties this mutual reference; `runSandbox` is only ever invoked after
		// `apiFunctions` is assigned below.
		let apiFunctions: Record<string, BoundHostFunction>;

		const runSandbox = (input: SandboxRunInput) =>
			Effect.scoped(
				Effect.gen(function* () {
					const selectedApiFunctions: Record<string, BoundHostFunction> = {};
					for (const key of input.allowedHostFunctions) {
						const fn = apiFunctions[key];
						if (fn) {
							selectedApiFunctions[key] = (...args) => fn(...args, input);
						}
					}

					const worker = yield* pool.get;
					yield* Effect.addFinalizer(() => invalidateProcess(pool, worker).pipe(Effect.orDie));
					yield* worker.responseQueue.takeAll.pipe(Effect.asVoid);

					const token = generateId();
					const now = yield* Clock.currentTimeMillis;
					yield* bridge.addSession(input.executionId, {
						token,
						apiFunctions: selectedApiFunctions,
						expiresAt: now + config.sandbox.timeoutMs + sessionTtlBufferMs,
					});
					yield* Effect.addFinalizer(() =>
						bridge.removeSession(input.executionId).pipe(Effect.orDie),
					);
					const requestLine = `${encodeSandboxRunnerRequest({
						token,
						scriptId: input.scriptId,
						context: input.context ?? {},
						driverName: input.driverName,
						metadata: input.metadata ?? {},
						executionId: input.executionId,
						compiledCode: input.compiledCode,
						compiledFormat: input.compiledFormat,
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: Object.keys(selectedApiFunctions),
					})}\n`;

					yield* worker.stdinQueue.offer(new TextEncoder().encode(requestLine));

					const responseLine = yield* Effect.raceFirst(
						worker.responseQueue.take,
						Effect.sleep(Duration.millis(config.sandbox.timeoutMs)).pipe(
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
						try: () => decodeSandboxRunnerResponse(responseLine),
						catch: makeInvalidResponse,
					});

					const executionMs = raw.timing?.executionMs;
					const finishedAt = yield* Clock.currentTimeMillis;
					const error = typeof raw.error === "string" ? raw.error : null;
					const totalMs = Math.max(1, Math.round(finishedAt - now));
					const logs = "logs" in raw && Array.isArray(raw.logs) ? raw.logs : [];

					return {
						logs,
						error,
						success: raw.success,
						executionId: input.executionId,
						value: raw.success ? (raw.value ?? null) : null,
						timing: { totalMs, executionMs: typeof executionMs === "number" ? executionMs : 0 },
					};
				}),
			).pipe(
				Effect.mapError((error) =>
					error instanceof TimeoutError || error instanceof SandboxRunError
						? error
						: new SandboxRunError({ message: unknownToMessage(error) }),
				),
			);

		const additionalApiFunctions = yield* makeAdditionalSandboxApiFunctions();

		apiFunctions = {
			getCachedValue: (...args) => {
				const key = args[0];
				const input = requireSandboxRunInput(args, 1, "getCachedValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("getCachedValue expects a non-empty key string"));
				}

				return runPromise(
					redis.get(getCacheKey(serverRun.id, input.scriptId, key.trim())).pipe(
						Effect.flatMap((cached) => {
							if (cached === null) {
								return Effect.succeed(apiSuccess(null));
							}
							return Schema.decode(Schema.parseJson(Schema.Unknown))(cached).pipe(
								Effect.map(apiSuccess),
								Effect.orElseSucceed(() =>
									apiFailure("getCachedValue: stored value is not valid JSON"),
								),
							);
						}),
						Effect.orDie,
					),
				);
			},
			httpCall: (...args) => {
				const method = args[0];
				const url = args[1];
				const options = args[2];
				if (typeof method !== "string" || !method.trim()) {
					return Promise.resolve(apiFailure("httpCall expects a non-empty method string"));
				}
				if (typeof url !== "string" || !url.trim()) {
					return Promise.resolve(apiFailure("httpCall expects a non-empty URL string"));
				}

				return runPromise(
					Effect.gen(function* () {
						const requestUrl = yield* Effect.try({
							try: () => new URL(url),
							catch: () => apiFailure("httpCall URL is invalid"),
						});
						const parsedOptions = yield* Effect.try({
							try: () => parseHttpCallOptions(options),
							catch: (error) => apiFailure(unknownToMessage(error)),
						});

						const httpMethod = yield* Match.value(method.trim().toUpperCase()).pipe(
							Match.when(isHttpMethod, (m) => Effect.succeed(m)),
							Match.orElse(() =>
								Effect.fail(apiFailure("httpCall method is not a valid HTTP method")),
							),
						);
						let request = HttpClientRequest.make(httpMethod)(requestUrl.toString());
						if (parsedOptions.body !== undefined) {
							request = HttpClientRequest.bodyText(parsedOptions.body)(request);
						}
						request = request.pipe(
							HttpClientRequest.setHeaders({ ...defaultHeaders, ...parsedOptions.headers }),
						);

						const [response, body] = yield* httpClient.execute(request).pipe(
							Effect.flatMap((res) => Effect.map(res.text, (text) => [res, text] as const)),
							Effect.timeout(Duration.millis(httpCallTimeoutMs)),
							Effect.mapError((error) => apiFailure(unknownToMessage(error))),
						);

						if (response.status < 200 || response.status >= 300) {
							return {
								...apiFailure(`HTTP ${response.status}`),
								data: { status: response.status },
							};
						}

						return apiSuccess({
							body,
							status: response.status,
							headers: response.headers,
						});
					}).pipe(Effect.catchAll((errorValue) => Effect.succeed(errorValue))),
				);
			},
			setCachedValue: (...args) => {
				const key = args[0];
				const value = args[1];
				const expiry = args[2];
				const input = requireSandboxRunInput(args, 3, "setCachedValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("setCachedValue expects a non-empty key string"));
				}
				if (typeof expiry !== "number" || !Number.isInteger(expiry) || expiry <= 0) {
					return Promise.resolve(
						apiFailure("setCachedValue expects a positive integer expiry in seconds"),
					);
				}

				return runPromise(
					Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
						Effect.flatMap((serialized) =>
							redis
								.set(getCacheKey(serverRun.id, input.scriptId, key.trim()), serialized, expiry)
								.pipe(Effect.as(apiSuccess(null)), Effect.orDie),
						),
						Effect.orElseSucceed(() =>
							apiFailure("setCachedValue value must be JSON-serializable"),
						),
					),
				);
			},
			...additionalApiFunctions,
		};

		return { run: runSandbox };
	}),
}) {}
