import type { HttpClientResponse } from "@effect/platform";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { isHttpMethod } from "@effect/platform/HttpMethod";
import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import {
	AUTOMATION_SANDBOX_HOST_CAPABILITIES,
	type CoreSandboxHostMethodMap,
} from "@ryot/sandbox-sdk";
import { generateId } from "better-auth";
import { Clock, Duration, Effect, Match, Runtime, Schema, Stream } from "effect";

import { AppConfig } from "../config/service";
import { redisKeys, RedisService } from "../redis";
import { ServerRun } from "../server-run";
import { makeAutomationSandboxApiFunctions } from "./automation-host-functions";
import { bindSandboxHostFunctions } from "./bridge-adapter";
import { makeAdditionalSandboxApiFunctions } from "./host-functions";
import {
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxContextError,
	sandboxHttpRequestBodyError,
	sandboxRunnerRequestError,
	SANDBOX_LIMITS,
	SANDBOX_RUNNER_LIMITS,
} from "./limits";
import { BridgeService, invalidateProcess, ProcessPool } from "./runtime";
import {
	apiFailure,
	apiSuccess,
	type BoundHostFunction,
	isJsonValue,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

const httpCallTimeoutMs = 8_000;
const sessionTtlBufferMs = 2_000;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const invalidResponseMessage = "Invalid JSON response from Deno process";
const defaultHeaders = { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" };
const getCacheKey = (serverRunId: string, scriptId: string, key: string) =>
	redisKeys.sandboxRunCache(serverRunId, scriptId, key);

const automationHostFunctions = new Set<string>(AUTOMATION_SANDBOX_HOST_CAPABILITIES);

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<SandboxRunInput, "allowedHostFunctions" | "subscriptionRun">,
) => {
	const selectedApiFunctions: Record<string, BoundHostFunction> = {};
	for (const key of input.allowedHostFunctions) {
		const fn = boundApiFunctions[key];
		if (fn && (!automationHostFunctions.has(key) || input.subscriptionRun)) {
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
	limits: Schema.Record({ key: Schema.String, value: Schema.Union(Schema.Number, Schema.String) }),
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
type SetCachedValueResult = Awaited<ReturnType<CoreSandboxHostMethodMap["setCachedValue"]>>;

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
		let apiFunctions: SandboxHostImplementationMap;

		const runSandbox = (input: SandboxRunInput) =>
			Effect.scoped(
				Effect.gen(function* () {
					const context = input.context ?? {};
					const contextError = sandboxContextError(context);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}

					const boundApiFunctions: Readonly<Record<string, BoundHostFunction>> =
						bindSandboxHostFunctions(apiFunctions, input);
					const selectedApiFunctions = selectSandboxHostFunctions(boundApiFunctions, input);

					const token = generateId();
					const requestLine = `${encodeSandboxRunnerRequest({
						token,
						context,
						scriptId: input.scriptId,
						driverName: input.driverName,
						limits: SANDBOX_RUNNER_LIMITS,
						metadata: input.metadata ?? {},
						executionId: input.executionId,
						compiledCode: input.compiledCode,
						compiledFormat: input.compiledFormat,
						apiBase: `http://127.0.0.1:${bridge.port}`,
						apiFunctions: Object.keys(selectedApiFunctions),
					})}\n`;
					const requestError = sandboxRunnerRequestError(requestLine);
					if (requestError) {
						return yield* new SandboxRunError({ message: requestError });
					}

					const worker = yield* pool.get;
					yield* Effect.addFinalizer(() => invalidateProcess(pool, worker).pipe(Effect.orDie));
					yield* worker.responseQueue.takeAll.pipe(Effect.asVoid);

					const now = yield* Clock.currentTimeMillis;
					yield* bridge.addSession(input.executionId, {
						token,
						apiFunctions: selectedApiFunctions,
						expiresAt: now + config.sandbox.timeoutMs + sessionTtlBufferMs,
					});
					yield* Effect.addFinalizer(() =>
						bridge.removeSession(input.executionId).pipe(Effect.orDie),
					);

					yield* worker.stdinQueue.offer(encoder.encode(requestLine));

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
					const error = raw.success
						? null
						: (raw.error ?? { phase: "load", message: "Sandbox runner failed without an error" });
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
		const automationApiFunctions = yield* makeAutomationSandboxApiFunctions();

		apiFunctions = {
			getCachedValue: (input, key) => {
				const keyError = sandboxCacheKeyError("getCachedValue", key);
				if (keyError) {
					return Promise.resolve(apiFailure(keyError));
				}

				return runPromise(
					redis.get(getCacheKey(serverRun.id, input.scriptId, key.trim())).pipe(
						Effect.flatMap((cached) => {
							if (cached === null) {
								return Effect.succeed(apiSuccess(null));
							}
							const valueError = sandboxCacheValueError("getCachedValue", cached, "stored value");
							if (valueError) {
								return Effect.succeed(apiFailure(valueError));
							}
							return Schema.decode(Schema.parseJson(Schema.Unknown))(cached).pipe(
								Effect.map((value) =>
									isJsonValue(value)
										? apiSuccess(value)
										: apiFailure("getCachedValue: stored value is not valid JSON"),
								),
								Effect.orElseSucceed(() =>
									apiFailure("getCachedValue: stored value is not valid JSON"),
								),
							);
						}),
						Effect.orDie,
					),
				);
			},
			httpCall: (_input, method, url, options) => {
				if (typeof method !== "string" || !method.trim()) {
					return Promise.resolve(apiFailure("httpCall expects a non-empty method string"));
				}
				if (typeof url !== "string" || !url.trim()) {
					return Promise.resolve(apiFailure("httpCall expects a non-empty URL string"));
				}
				const bodyError = sandboxHttpRequestBodyError(options?.body);
				if (bodyError) {
					return Promise.resolve(apiFailure(bodyError));
				}

				return runPromise(
					Effect.gen(function* () {
						const requestUrl = yield* Effect.try({
							try: () => new URL(url),
							catch: () => apiFailure("httpCall URL is invalid"),
						});
						const httpMethod = yield* Match.value(method.trim().toUpperCase()).pipe(
							Match.when(isHttpMethod, (m) => Effect.succeed(m)),
							Match.orElse(() =>
								Effect.fail(apiFailure("httpCall method is not a valid HTTP method")),
							),
						);
						let request = HttpClientRequest.make(httpMethod)(requestUrl.toString());
						if (options?.body !== undefined) {
							request = HttpClientRequest.bodyText(options.body)(request);
						}
						request = request.pipe(
							HttpClientRequest.setHeaders({ ...defaultHeaders, ...options?.headers }),
						);

						const [response, body] = yield* httpClient.execute(request).pipe(
							Effect.flatMap((res) =>
								res.status < 200 || res.status >= 300
									? Effect.succeed([res, ""] as const)
									: Effect.map(readSandboxHttpResponseText(res), (text) => [res, text] as const),
							),
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
			setCachedValue: (input, key, value, expiry) => {
				const keyError = sandboxCacheKeyError("setCachedValue", key);
				if (keyError) {
					return Promise.resolve(apiFailure(keyError));
				}
				const ttlError = sandboxCacheTtlError("setCachedValue", expiry, "expiry");
				if (ttlError) {
					return Promise.resolve(apiFailure(ttlError));
				}

				return runPromise(
					Schema.encode(Schema.parseJson(Schema.Unknown))(value).pipe(
						Effect.flatMap((serialized): Effect.Effect<SetCachedValueResult> => {
							const valueError = sandboxCacheValueError("setCachedValue", serialized);
							return valueError
								? Effect.succeed(apiFailure(valueError))
								: redis
										.set(getCacheKey(serverRun.id, input.scriptId, key.trim()), serialized, expiry)
										.pipe(Effect.as(apiSuccess(null)), Effect.orDie);
						}),
						Effect.orElseSucceed(() =>
							apiFailure("setCachedValue value must be JSON-serializable"),
						),
					),
				);
			},
			...additionalApiFunctions,
			...automationApiFunctions,
		};

		return { run: runSandbox };
	}),
}) {}
