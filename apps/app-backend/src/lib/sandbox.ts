import { and, eq, isNull, or } from "drizzle-orm";
import { Clock, Duration, Effect, Runtime, Schema } from "effect";

import { AppConfig } from "./config";
import { CurrentDb, DbRunner, dbEffect, schema } from "./db";
import { SandboxRunError, TimeoutError, unknownToMessage } from "./errors";
import { redisKeys, RedisService } from "./redis";
import { BridgeService, invalidateProcess, ProcessPool } from "./sandbox-runtime";

type BoundHostFunction = (...args: ReadonlyArray<unknown>) => Promise<unknown>;

type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

export type SandboxRunInput = {
	readonly code: string;
	readonly userId: string;
	readonly scriptId: string;
	readonly context: unknown;
	readonly driverName: string;
	readonly executionId: string;
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
const getCacheKey = (scriptId: string, key: string) => redisKeys.sandboxCache(scriptId, key);

const SandboxRunnerRequest = Schema.Struct({
	token: Schema.String,
	code: Schema.String,
	apiBase: Schema.String,
	context: Schema.Unknown,
	scriptId: Schema.String,
	driverName: Schema.String,
	executionId: Schema.String,
	apiFunctions: Schema.Array(Schema.String),
});

const SandboxRunnerResponse = Schema.Struct({
	success: Schema.Boolean,
	value: Schema.optional(Schema.Unknown),
	error: Schema.optional(Schema.NullOr(Schema.String)),
	logs: Schema.optional(Schema.Array(Schema.String)),
	timing: Schema.optional(Schema.Struct({ executionMs: Schema.Number })),
});

const encodeSandboxRunnerRequest = Schema.encodeSync(Schema.parseJson(SandboxRunnerRequest));
const decodeSandboxRunnerResponse = Schema.decodeUnknownSync(
	Schema.parseJson(SandboxRunnerResponse),
);

const apiSuccess = <T>(data: T) => ({ data, success: true as const });
const apiFailure = (error: string) => ({ error, success: false as const });

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

const isSandboxRunInput = (value: unknown): value is SandboxRunInput =>
	value !== null &&
	typeof value === "object" &&
	typeof Reflect.get(value, "userId") === "string" &&
	typeof Reflect.get(value, "scriptId") === "string" &&
	typeof Reflect.get(value, "driverName") === "string" &&
	typeof Reflect.get(value, "executionId") === "string";

const requireSandboxRunInput = (args: ReadonlyArray<unknown>, index: number, fnName: string) => {
	const input = args[index];
	if (!isSandboxRunInput(input)) {
		throw new Error(`${fnName} is missing sandbox execution input`);
	}

	return input;
};

const mapHeadersToObject = (headers: Headers) => {
	const headerObject: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		headerObject[key] = value;
	}
	return headerObject;
};

export class SandboxService extends Effect.Service<SandboxService>()("SandboxService", {
	dependencies: [ProcessPool.Default, BridgeService.Default],
	effect: Effect.gen(function* () {
		const pool = yield* ProcessPool;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const bridge = yield* BridgeService;
		const runtime = yield* Effect.runtime();
		const runPromise = Runtime.runPromise(runtime);

		const apiFunctions: Record<string, BoundHostFunction> = {
			executeQueryEngine: (...args) => {
				const query = args[0];
				const input = requireSandboxRunInput(args, 1, "executeQueryEngine");
				if (query === null || typeof query !== "object") {
					return Promise.resolve(apiFailure("Query engine input must be an object"));
				}

				const scope = Reflect.get(query, "scope");
				const slug = Array.isArray(scope) && typeof scope[0] === "string" ? scope[0] : null;
				if (!slug) {
					return Promise.resolve(apiFailure("Query engine scope is required"));
				}

				return runPromise(
					runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							const [entitySchema] = yield* dbEffect(() =>
								db
									.select({ id: schema.entitySchema.id })
									.from(schema.entitySchema)
									.where(
										and(
											eq(schema.entitySchema.slug, slug),
											or(
												isNull(schema.entitySchema.userId),
												eq(schema.entitySchema.userId, input.userId),
											),
										),
									)
									.limit(1),
							);
							if (!entitySchema) {
								return apiFailure(`Schema '${slug}' not found`);
							}

							const rows = yield* dbEffect(() =>
								db
									.select({ id: schema.entity.id, name: schema.entity.name })
									.from(schema.entity)
									.where(
										and(
											eq(schema.entity.entitySchemaId, entitySchema.id),
											or(isNull(schema.entity.userId), eq(schema.entity.userId, input.userId)),
										),
									),
							);

							return apiSuccess({
								data: {
									items: rows.map((row) => ({
										id: { kind: "text", value: row.id },
										name: { kind: "text", value: row.name },
									})),
								},
							});
						}),
					).pipe(Effect.catchAll((error) => Effect.succeed(apiFailure(error.message)))),
				);
			},
			getCachedValue: (...args) => {
				const key = args[0];
				const input = requireSandboxRunInput(args, 1, "getCachedValue");
				if (typeof key !== "string" || !key.trim()) {
					return Promise.resolve(apiFailure("getCachedValue expects a non-empty key string"));
				}

				return runPromise(redis.get(getCacheKey(input.scriptId, key.trim()))).then((cached) => {
					if (cached === null) {
						return apiSuccess(null);
					}

					try {
						return apiSuccess(JSON.parse(cached));
					} catch {
						return apiFailure("getCachedValue: stored value is not valid JSON");
					}
				});
			},
			getSystemConfig: () =>
				Promise.resolve(
					apiSuccess({
						auth: {
							oidcEnabled: false,
							localAuthDisabled: config.users.disableLocalAuth,
							signupAllowed: config.users.allowRegistration && !config.users.disableLocalAuth,
						},
					}),
				),
			getUserPreferences: () =>
				Promise.resolve(
					apiSuccess({
						languages: {
							providers: [
								{ source: "audible", preferredLanguage: "US" },
								{ source: "openlibrary", preferredLanguage: "en" },
							],
						},
					}),
				),
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

				let requestUrl: URL;
				try {
					requestUrl = new URL(url);
				} catch {
					return Promise.resolve(apiFailure("httpCall URL is invalid"));
				}

				let parsedOptions: HttpCallOptions;
				try {
					parsedOptions = parseHttpCallOptions(options);
				} catch (error) {
					return Promise.resolve(apiFailure(unknownToMessage(error)));
				}

				return fetch(requestUrl.toString(), {
					body: parsedOptions.body,
					method: method.trim().toUpperCase(),
					signal: AbortSignal.timeout(httpCallTimeoutMs),
					headers: { ...defaultHeaders, ...parsedOptions.headers },
				})
					.then((response) =>
						response.text().then((body) => {
							if (!response.ok) {
								return {
									...apiFailure(`HTTP ${response.status} ${response.statusText}`),
									data: { status: response.status },
								};
							}

							return apiSuccess({
								body,
								status: response.status,
								statusText: response.statusText,
								headers: mapHeadersToObject(response.headers),
							});
						}),
					)
					.catch((error) => apiFailure(unknownToMessage(error)));
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

				let serialized: string;
				try {
					serialized = JSON.stringify(value);
				} catch {
					return Promise.resolve(apiFailure("setCachedValue value must be JSON-serializable"));
				}

				return runPromise(
					redis.set(getCacheKey(input.scriptId, key.trim()), serialized, expiry),
				).then(() => apiSuccess(null));
			},
		};

		return {
			run: (input: SandboxRunInput) =>
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
						yield* worker.responseQueue.takeAll.pipe(Effect.asVoid);

						const token = crypto.randomUUID();
						const now = yield* Clock.currentTimeMillis;
						yield* bridge.addSession(input.executionId, {
							token,
							apiFunctions: selectedApiFunctions,
							expiresAt: now + config.sandbox.timeoutMs + sessionTtlBufferMs,
						});
						yield* Effect.addFinalizer(() =>
							bridge.removeSession(input.executionId).pipe(Effect.orDie),
						);

						const startedAt = yield* Clock.currentTimeMillis;
						const requestLine = `${encodeSandboxRunnerRequest({
							token,
							code: input.code,
							scriptId: input.scriptId,
							context: input.context ?? {},
							driverName: input.driverName,
							executionId: input.executionId,
							apiBase: `http://127.0.0.1:${bridge.port}`,
							apiFunctions: Object.keys(selectedApiFunctions),
						})}\n`;

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
							try: () => decodeSandboxRunnerResponse(responseLine),
							catch: makeInvalidResponse,
						}).pipe(
							Effect.catchAll((error) =>
								invalidateProcess(pool, worker).pipe(Effect.zipRight(Effect.fail(error))),
							),
						);

						const finishedAt = yield* Clock.currentTimeMillis;
						const totalMs = finishedAt - startedAt;
						const logs = "logs" in raw && Array.isArray(raw.logs) ? raw.logs : [];
						const error = typeof raw.error === "string" ? raw.error : null;
						const executionMs = raw.timing?.executionMs;

						return {
							logs,
							error,
							success: raw.success,
							executionId: input.executionId,
							value: raw.success ? (raw.value ?? null) : null,
							timing: {
								totalMs,
								executionMs: typeof executionMs === "number" ? executionMs : totalMs,
							},
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
}) {}
