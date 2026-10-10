import { unknownToMessage } from "@ryot-app/contract/errors";
import type { httpCallOptionsSchema } from "@ryot-app/sandbox-sdk/core";
import { httpCallResponseSchema } from "@ryot-app/sandbox-sdk/core";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import { Cause, Duration, Effect, Match, Option, Schema } from "effect";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientError,
	HttpClientRequest,
	HttpMethod,
	type HttpClientResponse,
} from "effect/http";

import { EgressDenied } from "../egress/http-client";
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
	"claimPersistentValue" | "getPersistentValue" | "getCachedValue" | "httpCall" | "setCachedValue"
>;

const persistentClaimEnvelopeSchema = Schema.Struct({
	value: Schema.Unknown,
	owner: Schema.NullOr(Schema.String),
});
export const encodePersistentClaimEnvelope = Schema.encodeUnknownEffect(
	Schema.fromJsonString(persistentClaimEnvelopeSchema),
);
const decodePersistentClaimEnvelope = Schema.decodeUnknownEffect(
	Schema.fromJsonString(persistentClaimEnvelopeSchema),
);

// A request that may have reached the server carries `external-uncertain` so the kernel can refuse
// to auto-retry it unless the hook declared run-ID idempotency.
const CERTAIN_HTTP_FAILURE_REASONS = new Set(["EncodeError", "InvalidUrlError"]);

const httpRequestFailure = (error: unknown) => {
	if (
		error instanceof HttpClientError.HttpClientError &&
		error.reason.cause instanceof EgressDenied
	) {
		return { data: { code: "destination-denied" }, message: "httpCall destination is not allowed" };
	}
	const certain =
		error instanceof HttpClientError.HttpClientError &&
		CERTAIN_HTTP_FAILURE_REASONS.has(error.reason._tag);
	return {
		message: unknownToMessage(error),
		...(certain ? {} : { data: { code: "external-uncertain" } }),
	};
};

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

// Redirects are followed by hand so every hop is classified before it is requested.
const withManualRedirects = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
		effect.pipe(
			Effect.provideService(FetchHttpClient.RequestInit, {
				...Option.getOrElse(init, () => ({})),
				redirect: "manual",
			}),
		),
	);

export const SANDBOX_HTTP_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
	"cookie",
	"authorization",
	"proxy-authorization",
]);
const REQUEST_BODY_HEADERS: ReadonlySet<string> = new Set([
	"content-type",
	"content-location",
	"content-encoding",
	"content-language",
]);

export const SANDBOX_HTTP_REDIRECT_STOPPED_MESSAGE =
	"httpCall redirect target requires durable rate-limit admission";

export const SandboxHttpRequest = Schema.Struct({
	url: Schema.String,
	method: Schema.String,
	body: Schema.optional(Schema.String),
	headers: Schema.Record(Schema.String, Schema.String),
});
export type SandboxHttpRequest = typeof SandboxHttpRequest.Type;

/** A hop the classifier stopped; it stays in the host and never reaches scripts. */
export const SandboxHttpRedirect = Schema.TaggedStruct("redirected", {
	...SandboxHttpRequest.fields,
	hop: Schema.Int,
});
export type SandboxHttpRedirect = typeof SandboxHttpRedirect.Type;

export const HttpHopResult = Schema.Union([
	Schema.TaggedStruct("completed", { result: httpCallResponseSchema }),
	SandboxHttpRedirect,
]);
export type HttpHopResult = typeof HttpHopResult.Type;

/** `follow` only for a hop proven unmatched by rate-limit policy; `stop` otherwise. */
export type SandboxHttpClassify = (url: string) => Effect.Effect<"follow" | "stop">;

type SandboxHttpOptions = typeof httpCallOptionsSchema.Type;

export const prepareSandboxHttpRequest = (
	method: string,
	url: string,
	options: SandboxHttpOptions | undefined,
): Effect.Effect<SandboxHttpRequest, SandboxHostError> => {
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
	if (Object.keys(options?.headers ?? {}).some((name) => name.toLowerCase() === "host")) {
		return sandboxHostFailure("httpCall may not set the Host header");
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
			return {
				method: httpMethod,
				url: requestUrl.toString(),
				headers: { ...defaultHeaders, ...options?.headers },
				...(options?.body === undefined ? {} : { body: options.body }),
			};
		}),
	);
};

// Fetch redirect semantics: 303 and POST under 301/302 become GET without a body, and credentials
// never cross origins.
const redirectRequest = (
	current: SandboxHttpRequest,
	status: number,
	location: string,
): Effect.Effect<SandboxHttpRequest, SandboxHostError> =>
	Effect.gen(function* () {
		const target = yield* Effect.try({
			try: () => new URL(location, current.url),
			catch: () => "httpCall redirect location is invalid",
		});
		if (target.protocol !== "http:" && target.protocol !== "https:") {
			return yield* Effect.fail("httpCall redirect location is not an HTTP(S) URL");
		}
		const method =
			(status === 303 && current.method !== "GET" && current.method !== "HEAD") ||
			((status === 301 || status === 302) && current.method === "POST")
				? "GET"
				: current.method;
		const crossOrigin = target.origin !== new URL(current.url).origin;
		const headers = Object.fromEntries(
			Object.entries(current.headers).filter(([name]) => {
				const lower = name.toLowerCase();
				return (
					!(crossOrigin && CREDENTIAL_HEADERS.has(lower)) &&
					!(method !== current.method && REQUEST_BODY_HEADERS.has(lower))
				);
			}),
		);
		return {
			method,
			headers,
			url: target.toString(),
			...(method === current.method && current.body !== undefined ? { body: current.body } : {}),
		};
	}).pipe(sandboxHostEffect);

/**
 * Sends `request` as hop `hop`, following only redirects `classify` proves unmatched; a stopped
 * hop is returned unrequested so the caller can admit it.
 */
export const executeSandboxHttp = (
	request: SandboxHttpRequest,
	options: {
		readonly hop: number;
		readonly classify: SandboxHttpClassify;
		readonly allowInsecureConnections: boolean | undefined;
	},
): Effect.Effect<HttpHopResult, SandboxHostError, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient;
		let current = request;
		let hop = options.hop;
		for (;;) {
			const method = current.method;
			if (!HttpMethod.isHttpMethod(method)) {
				return yield* sandboxHostFailure("httpCall method is not a valid HTTP method");
			}
			let outgoing = HttpClientRequest.make(method)(current.url);
			if (current.body !== undefined) {
				outgoing = HttpClientRequest.bodyText(current.body)(outgoing);
			}
			outgoing = outgoing.pipe(HttpClientRequest.setHeaders(current.headers));
			const response = yield* applySandboxHttpRequestInit(
				withManualRedirects(httpClient.execute(outgoing)),
				options.allowInsecureConnections,
			).pipe(Effect.mapError(httpRequestFailure));
			const location = response.headers["location"];
			if (REDIRECT_STATUSES.has(response.status) && location !== undefined) {
				if (hop >= SANDBOX_HTTP_REDIRECT_HOPS) {
					return yield* sandboxHostFailure(
						`httpCall exceeded ${SANDBOX_HTTP_REDIRECT_HOPS} redirects`,
					);
				}
				hop += 1;
				current = yield* redirectRequest(current, response.status, location);
				if ((yield* options.classify(current.url)) === "stop") {
					return { ...current, hop, _tag: "redirected" as const };
				}
				continue;
			}
			const body = yield* readSandboxHttpResponseText(response).pipe(
				Effect.mapError(httpRequestFailure),
			);
			const result = { body, status: response.status, headers: { ...response.headers } };
			if (response.status < 200 || response.status >= 300) {
				return yield* Effect.fail({ data: result, message: `HTTP ${response.status}` });
			}
			return { result, _tag: "completed" as const };
		}
	}).pipe(
		Effect.timeoutOrElse({
			duration: Duration.millis(SANDBOX_LIMITS.http.timeoutMs),
			orElse: () => Effect.fail(httpRequestFailure(new Cause.TimeoutError())),
		}),
	);

export const makeRuntimeSandboxApiFunctions = (
	classify: SandboxHttpClassify,
): Effect.Effect<
	RuntimeSandboxHostImplementationMap,
	never,
	RedisService | ServerRun | HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const serverRun = yield* ServerRun;
		const httpClient = yield* HttpClient.HttpClient;

		return {
			// Inline and live calls cannot wait for admission, so a stopped redirect fails the call.
			httpCall: (_input, method, url, options) =>
				prepareSandboxHttpRequest(method, url, options).pipe(
					Effect.flatMap((request) =>
						executeSandboxHttp(request, {
							hop: 0,
							classify,
							allowInsecureConnections: options?.allowInsecureConnections,
						}),
					),
					Effect.provideService(HttpClient.HttpClient, httpClient),
					Effect.flatMap((outcome) =>
						outcome._tag === "completed"
							? Effect.succeed(outcome.result)
							: sandboxHostFailure(SANDBOX_HTTP_REDIRECT_STOPPED_MESSAGE),
					),
				),
			setCachedValue: (input, key, value, expiry) => {
				return sandboxCacheInputGuard(
					"setCachedValue",
					key,
					() => {
						const redisKey = redisKeys.sandboxRunCache(
							serverRun.id,
							sandboxRunUserId(input),
							input.principal.providerId ?? input.principal.scriptId,
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
			getPersistentValue: (input, key) =>
				sandboxCacheInputGuard("getPersistentValue", key, () =>
					Effect.uninterruptible(
						redis.get(
							redisKeys.sandboxCache(
								sandboxRunUserId(input),
								input.principal.providerId ?? input.principal.scriptId,
								key.trim(),
							),
						),
					).pipe(
						Effect.flatMap((stored) =>
							stored === null
								? Effect.succeed(null)
								: decodePersistentClaimEnvelope(stored).pipe(
										Effect.flatMap(({ value }) =>
											isJsonValue(value)
												? encodeSandboxCacheValue("getPersistentValue", value).pipe(
														Effect.as(value),
													)
												: Effect.fail("getPersistentValue: stored value is not valid JSON"),
										),
										Effect.mapError(() => "getPersistentValue: stored claim is invalid"),
									),
						),
						sandboxHostEffect,
					),
				),
			getCachedValue: (input, key) => {
				return sandboxCacheInputGuard("getCachedValue", key, () => {
					const redisKey = redisKeys.sandboxRunCache(
						serverRun.id,
						sandboxRunUserId(input),
						input.principal.providerId ?? input.principal.scriptId,
						key.trim(),
					);

					return Effect.uninterruptible(redis.get(redisKey)).pipe(
						Effect.flatMap((cached) => {
							if (cached === null) {
								return Effect.succeed(null);
							}
							const valueError = sandboxCacheValueError("getCachedValue", cached, "stored value");
							if (valueError) {
								return Effect.fail(valueError);
							}
							return Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(cached).pipe(
								Effect.filterOrFail(
									isJsonValue,
									() => "getCachedValue: stored value is not valid JSON",
								),
								Effect.mapError(() => "getCachedValue: stored value is not valid JSON"),
							);
						}),
						sandboxHostEffect,
					);
				});
			},
			claimPersistentValue: (input, key, value, ttlSeconds) => {
				return sandboxCacheInputGuard(
					"claimPersistentValue",
					key,
					() => {
						const redisKey = redisKeys.sandboxCache(
							sandboxRunUserId(input),
							input.principal.providerId ?? input.principal.scriptId,
							key.trim(),
						);

						return Effect.gen(function* () {
							yield* encodeSandboxCacheValue("claimPersistentValue", value);
							const serialized = yield* encodePersistentClaimEnvelope({
								value,
								owner: input.workflowExecutionId ? input.executionId : null,
							}).pipe(
								Effect.mapError(() => "claimPersistentValue value must be JSON-serializable"),
							);

							const setResult = yield* Effect.tryPromise({
								catch: unknownToMessage,
								try: () => redis.client.set(redisKey, serialized, "EX", ttlSeconds, "NX"),
							});
							if (setResult !== null) {
								return { claimed: true as const };
							}

							const existing = yield* Effect.uninterruptible(
								Effect.tryPromise({
									catch: unknownToMessage,
									try: () => redis.client.get(redisKey),
								}),
							);
							if (existing === null) {
								return { value: null, claimed: false };
							}
							return yield* decodePersistentClaimEnvelope(existing).pipe(
								Effect.map(({ owner, value: storedValue }) =>
									owner !== null && owner === input.executionId
										? ({ claimed: true as const } as const)
										: ({
												claimed: false as const,
												value: isJsonValue(storedValue) ? storedValue : null,
											} as const),
								),
								Effect.orElseSucceed(() => ({ value: null, claimed: false as const })),
							);
						}).pipe(sandboxHostEffect);
					},
					ttlSeconds,
					"TTL",
				);
			},
		};
	});
