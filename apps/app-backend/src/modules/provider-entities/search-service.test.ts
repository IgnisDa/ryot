import { assert, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot/contract/modules/provider-entities/schemas";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService } from "#lib/test-utils/effect";
import {
	PluginRuntimeResolver,
	UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProviderEntitySearchService } from "./search-service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const providerId = SandboxProviderId.make("provider-1");
const provider = {
	name: "Books",
	id: providerId,
	pluginId: "books",
	slug: "books.provider",
	rootEntitySchemaSlug: "book",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "books" },
};

const optionsSchema = {
	unknownKeys: "strict",
	fields: {
		passRawQuery: {
			type: "boolean",
			label: "Pass raw query",
			description: "Pass the raw query to the provider",
		},
	},
} satisfies AppSchema;

const dynamicOptionsSchema = {
	unknownKeys: "strict",
	fields: {
		status: {
			type: "enum",
			label: "Status",
			description: "Status",
			choices: { kind: "dynamic", source: "statuses" },
		},
	},
} satisfies AppSchema;

const searchScript = {
	providerId,
	source: "source",
	pluginId: "books",
	compiledFormat: 1,
	name: "Books search",
	slug: "books.search",
	compiledCode: "compiled",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	contentHash: "books-search-hash",
	id: SandboxScriptId.make("search-script-id"),
	metadata: {
		capabilities: [],
		name: "Books search",
		slug: "books.search",
		kind: "provider" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		providerSlug: "books.provider",
		providerOperation: "search" as const,
	},
};

const searchOptionsScript = {
	...searchScript,
	name: "Books search options",
	slug: "books.search-options",
	contentHash: "books-search-options-hash",
	id: SandboxScriptId.make("search-options-script-id"),
	metadata: {
		...searchScript.metadata,
		name: "Books search options",
		slug: "books.search-options",
		providerOperation: "search-options" as const,
	},
};

const makeLayer = (input?: {
	readonly redis?: RedisService["Service"];
	readonly optionsSchema?: AppSchema | null;
	readonly provider?: typeof provider | null;
	readonly optionsScript?: typeof searchOptionsScript;
	readonly searchError?: "inactive_provider" | "unsupported_operation";
	readonly execute?: SandboxExecutionService["Service"]["executeScript"];
	readonly searchOptionsError?:
		| "inactive_provider"
		| "unsupported_operation"
		| "script_unavailable";
}) =>
	ProviderEntitySearchService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(PluginRuntimeResolver)({
					findActiveProviderById: () =>
						Effect.succeed(input?.provider === undefined ? provider : input.provider),
					resolveSearchScript: () =>
						input?.searchError
							? Effect.fail(
									new UnsupportedProviderOperationError({
										providerId,
										operation: "search",
										reason: input.searchError,
										providerSlug: provider.slug,
									}),
								)
							: Effect.succeed({ ...searchScript, optionsSchema: input?.optionsSchema ?? null }),
					resolveSearchOptionsScript: () =>
						input?.searchOptionsError
							? Effect.fail(
									new UnsupportedProviderOperationError({
										providerId,
										operation: "search-options",
										providerSlug: provider.slug,
										reason: input.searchOptionsError,
									}),
								)
							: Effect.succeed(input?.optionsScript ?? searchOptionsScript),
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript:
						input?.execute ??
						((run) =>
							Effect.succeed({
								logs: [],
								error: null,
								status: "completed" as const,
								value: { items: [{ title: "Book", externalId: `${run.scriptId}-external` }] },
							})),
				}),
				Layer.succeed(RedisService, input?.redis ?? makeRedisService()),
			),
		),
	);

const assertFailureInstance = <A, E>(
	exit: Exit.Exit<A, E>,
	error: typeof ProviderEntityBadRequest | typeof ProviderEntityNotFound,
) => {
	assert(Exit.isFailure(exit));
	const failure = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(failure));
	expect(failure.value).toBeInstanceOf(error);
};

const makeSearchOptionsRedis = (initial: string | null = null) => {
	let value = initial;
	let writes = 0;
	return {
		getValue: () => value,
		getWrites: () => writes,
		service: makeRedisService({
			get: () => Effect.succeed(value),
			set: (_key, nextValue) => {
				value = nextValue;
				writes += 1;
				return Effect.void;
			},
		}),
	};
};

it.effect("executes one provider search and returns its singular response", () => {
	const executions: Array<Parameters<SandboxExecutionService["Service"]["executeScript"]>[0]> = [];

	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const result = yield* service.search(user, {
			page: 2,
			providerId,
			pageSize: 10,
			query: "book",
			options: { passRawQuery: true },
		});

		expect(result).toEqual({
			providerId,
			providerName: "Books",
			rootEntitySchemaSlug: "book",
			items: [{ externalId: "search-script-id-external", title: "Book" }],
		});
		expect(executions).toHaveLength(1);
		expect(executions[0]).toMatchObject({
			scriptId: "search-script-id",
			authority: { type: "user", userId: user.id },
			input: { query: "book", page: 2, pageSize: 10, options: { passRawQuery: true } },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema,
				execute: (input) => {
					executions.push(input);
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { items: [{ title: "Book", externalId: "search-script-id-external" }] },
					});
				},
			}),
		),
	);
});

it.effect("returns no schema when the provider search has no options", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		expect(yield* service.resolveSearchOptionsSchema(user, providerId)).toBeNull();
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("returns static options without executing the auxiliary operation", () => {
	let executions = 0;
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
		expect(schema).toEqual(optionsSchema);
		expect(executions).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema,
				execute: () => {
					executions += 1;
					return Effect.die("unused");
				},
			}),
		),
	);
});

it.effect("keeps required static options validation for omitted options", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { page: 1, providerId, pageSize: 20, query: "book" }),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: {
					unknownKeys: "strict",
					fields: {
						status: {
							type: "enum",
							label: "Status",
							description: "Status",
							validation: { required: true },
							choices: { kind: "static", values: [{ value: "active" }] },
						},
					},
				} satisfies AppSchema,
				execute: () => Effect.die("unused"),
			}),
		),
	),
);

it.effect("executes and materializes dynamic search options", () => {
	const redis = makeSearchOptionsRedis();
	const executions: Array<Parameters<SandboxExecutionService["Service"]["executeScript"]>[0]> = [];
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
		expect(schema).toMatchObject({
			fields: {
				status: {
					choices: { kind: "static", values: [{ value: "active", label: "Active" }] },
				},
			},
		});
		expect(executions).toHaveLength(1);
		expect(executions[0]).toMatchObject({
			input: {},
			scriptId: searchOptionsScript.id,
			authority: { type: "user", userId: user.id },
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				redis: redis.service,
				execute: (input) => {
					executions.push(input);
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { sources: { statuses: [{ value: "active", label: "Active" }] } },
					});
				},
			}),
		),
	);
});

it.effect("uses cached dynamic options without executing the auxiliary operation twice", () => {
	const redis = makeSearchOptionsRedis();
	let executions = 0;
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		yield* service.resolveSearchOptionsSchema(user, providerId);
		yield* service.resolveSearchOptionsSchema(user, providerId);
		expect(executions).toBe(1);
		expect(redis.getWrites()).toBe(1);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				redis: redis.service,
				execute: (input) => {
					if (input.scriptId !== searchOptionsScript.id) {
						return Effect.die("unexpected search execution");
					}
					executions += 1;
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { sources: { statuses: [{ value: "active" }] } },
					});
				},
			}),
		),
	);
});

it.effect("refreshes malformed cached dynamic options", () => {
	const redis = makeSearchOptionsRedis("not-json");
	let executions = 0;
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		expect(yield* service.resolveSearchOptionsSchema(user, providerId)).not.toBeNull();
		expect(executions).toBe(1);
		expect(redis.getWrites()).toBe(1);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				redis: redis.service,
				execute: () => {
					executions += 1;
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { sources: { statuses: [{ value: "active" }] } },
					});
				},
			}),
		),
	);
});

it.effect("refreshes a decodable stale cache missing a required source", () => {
	const redis = makeSearchOptionsRedis(
		JSON.stringify({ sources: { other: [{ value: "active" }] } }),
	);
	let executions = 0;
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
		expect(schema).toMatchObject({
			fields: {
				status: { choices: { kind: "static", values: [{ value: "active", label: "Active" }] } },
			},
		});
		expect(executions).toBe(1);
		expect(redis.getWrites()).toBe(1);
		expect(redis.getValue()).toBe('{"sources":{"statuses":[{"value":"active","label":"Active"}]}}');
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				redis: redis.service,
				execute: () => {
					executions += 1;
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { sources: { statuses: [{ value: "active", label: "Active" }] } },
					});
				},
			}),
		),
	);
});

it.effect("does not cache malformed or unmaterializable search-options results", () => {
	const cases = [
		{ sources: { other: [{ value: "active" }] } },
		{ sources: { statuses: [{ value: "" }] } },
	];
	return Effect.forEach(cases, (value) => {
		const redis = makeSearchOptionsRedis();
		return Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(service.resolveSearchOptionsSchema(user, providerId));
			assertFailureInstance(exit, ProviderEntityBadRequest);
			expect(redis.getWrites()).toBe(0);
		}).pipe(
			Effect.provide(
				makeLayer({
					optionsSchema: dynamicOptionsSchema,
					redis: redis.service,
					execute: () =>
						Effect.succeed({ value, logs: [], error: null, status: "completed" as const }),
				}),
			),
		);
	});
});

it.effect("keeps plain dynamic searches available when options resolution fails", () => {
	const executions: Array<Parameters<SandboxExecutionService["Service"]["executeScript"]>[0]> = [];
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		yield* service.search(user, { page: 1, providerId, pageSize: 20, query: "book" });
		expect(executions).toHaveLength(1);
		expect(executions[0]).toMatchObject({ scriptId: searchScript.id, input: { query: "book" } });
		expect(executions[0]?.input).not.toHaveProperty("options");
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				searchOptionsError: "unsupported_operation",
				execute: (input) => {
					executions.push(input);
					return Effect.succeed({
						logs: [],
						error: null,
						value: { items: [] },
						status: "completed" as const,
					});
				},
			}),
		),
	);
});

it.effect("rejects filtered dynamic searches when options resolution fails", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, {
				page: 1,
				providerId,
				pageSize: 20,
				query: "book",
				options: { status: "active" },
			}),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(
		Effect.provide(
			makeLayer({ optionsSchema: dynamicOptionsSchema, searchOptionsError: "script_unavailable" }),
		),
	),
);

it.effect("validates dynamic option membership before provider search execution", () => {
	const redis = makeSearchOptionsRedis();
	const executions: Array<Parameters<SandboxExecutionService["Service"]["executeScript"]>[0]> = [];
	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, {
				page: 1,
				providerId,
				pageSize: 20,
				query: "book",
				options: { status: "unknown" },
			}),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
		expect(executions).toHaveLength(1);
		expect(executions[0]?.scriptId).toBe(searchOptionsScript.id);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema: dynamicOptionsSchema,
				redis: redis.service,
				execute: (input) => {
					executions.push(input);
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value:
							input.scriptId === searchOptionsScript.id
								? { sources: { statuses: [{ value: "active" }] } }
								: { items: [] },
					});
				},
			}),
		),
	);
});

it.effect("rejects invalid provider search options before execution", () => {
	let executions = 0;

	return Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, {
				page: 1,
				providerId,
				pageSize: 20,
				query: "book",
				options: { passRawQuery: "yes" },
			}),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
		expect(executions).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				optionsSchema,
				execute: () => {
					executions += 1;
					return Effect.succeed({
						logs: [],
						error: null,
						value: { items: [] },
						status: "completed" as const,
					});
				},
			}),
		),
	);
});

it.effect("rejects options when the provider operation has no options schema", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { page: 1, providerId, options: {}, pageSize: 20, query: "book" }),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("rejects a missing provider", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, ProviderEntityNotFound);
	}).pipe(Effect.provide(makeLayer({ provider: null }))),
);

it.effect("rejects an inactive provider", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, ProviderEntityNotFound);
	}).pipe(Effect.provide(makeLayer({ searchError: "inactive_provider" }))),
);

it.effect("rejects a provider without a search operation", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(Effect.provide(makeLayer({ searchError: "unsupported_operation" }))),
);

it.effect("fails the whole request when provider execution fails", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { page: 1, providerId, pageSize: 20, query: "book" }),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(
		Effect.provide(
			makeLayer({
				execute: () =>
					Effect.succeed({
						logs: [],
						value: null,
						status: "completed" as const,
						error: { phase: "execute" as const, message: "provider unavailable" },
					}),
			}),
		),
	),
);

it.effect("fails the whole request when provider output cannot be decoded", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, ProviderEntityBadRequest);
	}).pipe(
		Effect.provide(
			makeLayer({
				execute: () =>
					Effect.succeed({
						logs: [],
						error: null,
						value: { items: [{}] },
						status: "completed" as const,
					}),
			}),
		),
	),
);
