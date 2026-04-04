import type { HttpClientResponse } from "@effect/platform";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { isHttpMethod } from "@effect/platform/HttpMethod";
import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot/contract/errors";
import { SandboxExecutionError } from "@ryot/contract/modules/sandbox/schemas";
import {
	AUTOMATION_SANDBOX_HOST_CAPABILITIES,
	SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES,
} from "@ryot/sandbox-sdk/core";
import { generateId } from "better-auth";
import { Clock, Duration, Effect, Match, Schema, Stream } from "effect";

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
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import { BridgeService, invalidateProcess, ProcessPool } from "./runtime";
import {
	type BoundHostFunction,
	isJsonValue,
	sandboxHostEffect,
	sandboxHostFailure,
	type SandboxHostImplementationMap,
	type SandboxRunInput,
} from "./shared";

const httpCallTimeoutMs = 8_000;
const sessionTtlBufferMs = 2_000;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const invalidResponseMessage = "Invalid JSON response from Deno process";
const defaultHeaders = { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" };
const automationHostFunctions = new Set<string>(AUTOMATION_SANDBOX_HOST_CAPABILITIES);
const systemCronHostFunctions = new Set<string>(SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES);

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<
		SandboxRunInput,
		"allowedHostFunctions" | "driverName" | "subscriptionRun" | "userId"
	>,
) => {
	const selectedApiFunctions: Record<string, BoundHostFunction> = {};
	for (const key of input.allowedHostFunctions) {
		const fn = boundApiFunctions[key];
		if (
			fn &&
			(!automationHostFunctions.has(key) || input.subscriptionRun) &&
			(!systemCronHostFunctions.has(key) ||
				(input.userId === null && input.driverName === "cron" && !input.subscriptionRun))
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
export class SandboxService extends Effect.Service<SandboxService>()("SandboxService", {
	dependencies: [FetchHttpClient.layer, ProcessPool.Default, BridgeService.Default],
	effect: Effect.gen(function* () {
		const pool = yield* ProcessPool;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const bridge = yield* BridgeService;

		const httpClient = yield* HttpClient.HttpClient;

		// `runSandbox` reads `apiFunctions`, and some host functions are built from `runSandbox`
		// (an automation can create events, which evaluates further policies and subscriptions).
		// The late `let` binding ties this mutual reference; `runSandbox` is only ever invoked after
		// `apiFunctions` is assigned below.
		let apiFunctions: Omit<SandboxHostImplementationMap, "log" | "span">;

		const runSandbox = (input: SandboxRunInput) =>
			Effect.scoped(
				Effect.gen(function* () {
					const context = input.context ?? {};
					const contextError = sandboxContextError(context);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}

					const collector = makeSandboxObservabilityCollector();
					const executionApiFunctions = {
						...apiFunctions,
						...makeObservabilitySandboxApiFunctions(collector),
					};
					const boundApiFunctions: Readonly<Record<string, BoundHostFunction>> =
						bindSandboxHostFunctions(executionApiFunctions, input);
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
					const parentSpan = yield* Effect.currentSpan;
					yield* bridge.addSession(input.executionId, {
						token,
						parentSpan,
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
					const consoleLogs = "logs" in raw && Array.isArray(raw.logs) ? raw.logs : [];
					const logs = mergeSandboxExecutionLogs(consoleLogs, collector);

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
				Effect.withSpan("sandbox.execution", {
					attributes: {
						scriptId: input.scriptId,
						driverName: input.driverName,
						executionId: input.executionId,
					},
				}),
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
					return sandboxHostFailure(keyError);
				}

				return sandboxHostEffect(
					redis
						.get(redisKeys.sandboxRunCache(serverRun.id, input.userId, input.scriptId, key.trim()))
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
												input.userId,
												input.scriptId,
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
