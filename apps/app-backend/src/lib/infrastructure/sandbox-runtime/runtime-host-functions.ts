import { unknownToMessage } from "@ryot/contract/errors";
import { Duration, Effect, Match, Schema } from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
	HttpMethod,
	type HttpClientResponse,
} from "effect/unstable/http";

import { redisKeys, RedisService } from "../redis";
import { ServerRun } from "../server-run";
import {
	sandboxCacheKeyError,
	sandboxCacheTtlError,
	sandboxCacheValueError,
	sandboxHttpRequestBodyError,
	SANDBOX_LIMITS,
} from "./limits";
import {
	isJsonValue,
	sandboxHostEffect,
	sandboxHostFailure,
	sandboxRunUserId,
	type SandboxHostImplementationMap,
} from "./shared";
import { readSandboxByteLimitedText } from "./stream-utils";

type BunRequestInit = RequestInit & { tls: { rejectUnauthorized: boolean } };
const insecureRequestInit: BunRequestInit = { tls: { rejectUnauthorized: false } };
const defaultHeaders = { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" };

export type RuntimeSandboxHostImplementationMap = Pick<
	SandboxHostImplementationMap,
	"claimPersistentValue" | "getCachedValue" | "httpCall" | "setCachedValue"
>;

export const readSandboxHttpResponseText = (response: HttpClientResponse.HttpClientResponse) =>
	readSandboxByteLimitedText(
		response.stream,
		SANDBOX_LIMITS.http.responseBytes,
		`httpCall response body exceeds ${SANDBOX_LIMITS.http.responseBytes} bytes`,
	);

const sandboxCacheInputError = (fnName: string, key: unknown, ttl?: unknown, ttlLabel?: string) => {
	const keyError = sandboxCacheKeyError(fnName, key);
	if (keyError) {
		return keyError;
	}
	if (ttlLabel !== undefined) {
		return sandboxCacheTtlError(fnName, ttl, ttlLabel);
	}
	return null;
};

const sandboxCacheInputGuard = <A, E>(
	fnName: string,
	key: unknown,
	effect: () => Effect.Effect<A, E>,
	ttl?: unknown,
	ttlLabel?: string,
) => {
	const error = sandboxCacheInputError(fnName, key, ttl, ttlLabel);
	return error ? sandboxHostFailure(error) : effect();
};

const encodeSandboxCacheValue = (fnName: string, value: unknown) =>
	Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(
		Effect.mapError(() => `${fnName} value must be JSON-serializable`),
		Effect.flatMap((serialized) => {
			const valueError = sandboxCacheValueError(fnName, serialized);
			return valueError ? Effect.fail(valueError) : Effect.succeed(serialized);
		}),
	);

export const applySandboxHttpRequestInit = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	allowInsecureConnections: boolean | undefined,
) =>
	allowInsecureConnections
		? effect.pipe(Effect.provideService(FetchHttpClient.RequestInit, insecureRequestInit))
		: effect;

export const makeRuntimeSandboxApiFunctions: Effect.Effect<
	RuntimeSandboxHostImplementationMap,
	never,
	RedisService | ServerRun | HttpClient.HttpClient
> = Effect.gen(function* () {
	const redis = yield* RedisService;
	const serverRun = yield* ServerRun;
	const httpClient = yield* HttpClient.HttpClient;

	return {
		claimPersistentValue: (input, key, value, ttlSeconds) => {
			return sandboxCacheInputGuard(
				"claimPersistentValue",
				key,
				() => {
					const redisKey = redisKeys.sandboxCache(
						sandboxRunUserId(input),
						input.providerId ?? input.scriptId,
						key.trim(),
					);

					return Effect.gen(function* () {
						const serialized = yield* encodeSandboxCacheValue("claimPersistentValue", value);

						const setResult = yield* Effect.tryPromise({
							try: () => redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
							catch: unknownToMessage,
						});
						if (setResult !== null) {
							return { claimed: true as const };
						}

						const existing = yield* Effect.tryPromise({
							try: () => redis.client.get(redisKey),
							catch: unknownToMessage,
						});
						if (existing === null) {
							return { claimed: false, value: null };
						}
						const existingValueError = sandboxCacheValueError(
							"claimPersistentValue",
							existing,
							"stored value",
						);
						if (existingValueError) {
							return yield* Effect.fail(existingValueError);
						}

						return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
							existing,
						).pipe(
							Effect.map((decoded) => ({
								claimed: false as const,
								value: isJsonValue(decoded) ? decoded : null,
							})),
							Effect.orElseSucceed(() => ({ claimed: false as const, value: null })),
						);
					}).pipe(sandboxHostEffect);
				},
				ttlSeconds,
				"TTL",
			);
		},
		getCachedValue: (input, key) => {
			return sandboxCacheInputGuard("getCachedValue", key, () => {
				const redisKey = redisKeys.sandboxRunCache(
					serverRun.id,
					sandboxRunUserId(input),
					input.providerId ?? input.scriptId,
					key.trim(),
				);

				return redis
					.get(redisKey)
					.pipe(
						Effect.flatMap((cached) => {
							if (cached === null) {
								return Effect.succeed(null);
							}
							const valueError = sandboxCacheValueError("getCachedValue", cached, "stored value");
							if (valueError) {
								return Effect.fail(valueError);
							}
							return Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(cached).pipe(
								Effect.flatMap((value) =>
									isJsonValue(value)
										? Effect.succeed(value)
										: Effect.fail("getCachedValue: stored value is not valid JSON"),
								),
								Effect.mapError(() => "getCachedValue: stored value is not valid JSON"),
							);
						}),
					)
					.pipe(sandboxHostEffect);
			});
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
						Match.when(HttpMethod.isHttpMethod, (m) => Effect.succeed(m)),
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
							Effect.map(readSandboxHttpResponseText(res), (text) => [res, text] as const),
						),
						Effect.timeout(Duration.millis(SANDBOX_LIMITS.http.timeoutMs)),
						Effect.mapError(unknownToMessage),
					);

					if (response.status < 200 || response.status >= 300) {
						return yield* Effect.fail({
							message: `HTTP ${response.status}`,
							data: { body, status: response.status },
						});
					}

					return { body, status: response.status, headers: response.headers };
				}),
			);
		},
		setCachedValue: (input, key, value, expiry) => {
			return sandboxCacheInputGuard(
				"setCachedValue",
				key,
				() => {
					const redisKey = redisKeys.sandboxRunCache(
						serverRun.id,
						sandboxRunUserId(input),
						input.providerId ?? input.scriptId,
						key.trim(),
					);

					return encodeSandboxCacheValue("setCachedValue", value).pipe(
						Effect.flatMap((serialized) =>
							redis.set(redisKey, serialized, expiry).pipe(Effect.as(null)),
						),
						sandboxHostEffect,
					);
				},
				expiry,
				"expiry",
			);
		},
	};
});
