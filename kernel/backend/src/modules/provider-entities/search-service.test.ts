import { assert, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";

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
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
} satisfies CurrentUserValue;

const providerId = SandboxProviderId.make("provider-1");
const provider = {
	id: providerId,
	name: "Records",
	pluginId: "records",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	slug: "records.provider",
	rootEntitySchemaSlug: "record",
	pluginScope: "system" as const,
	information: { source: "records" },
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
	compiledFormat: 1,
	pluginId: "records",
	name: "Records search",
	slug: "records.search",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	compiledCode: "compiled",
	contentHash: "records-search-hash",
	pluginRevisionId: "records-revision",
	id: SandboxScriptId.make("search-script-id"),
	metadata: {
		capabilities: [],
		name: "Records search",
		slug: "records.search",
		kind: "provider" as const,
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		providerSlug: "records.provider",
		providerOperation: "search" as const,
	},
};

const searchOptionsScript = {
	...searchScript,
	optionsSchema: null,
	name: "Records search options",
	slug: "records.search-options",
	contentHash: "records-search-options-hash",
	id: SandboxScriptId.make("search-options-script-id"),
	metadata: {
		...searchScript.metadata,
		name: "Records search options",
		slug: "records.search-options",
		providerOperation: "search-options" as const,
	},
};

type ResolutionCounts = { provider: number; search: number; searchOptions: number };

type Execute = SandboxExecutionService["Service"]["executeScript"];
type ExecuteInput = Parameters<Execute>[0];

class FakeProviderSearch extends Context.Service<
	FakeProviderSearch,
	{
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteInput>>;
		readonly resolutions: Effect.Effect<ResolutionCounts>;
		readonly cachedOptions: Effect.Effect<string | null>;
		readonly cacheWrites: Effect.Effect<number>;
		readonly respondWith: (execute: Execute) => Effect.Effect<void>;
	}
>()("test/FakeProviderSearch") {}

const defaultExecute: Execute = (run) =>
	Effect.succeed({
		logs: [],
		error: null,
		status: "completed" as const,
		value: { items: [{ title: "Record", externalId: `${run.scriptId}-external` }] },
	});

/** Without `cached`, the cache dies when used; any `cached` value (even `null`) enables it. */
const makeLayer = (input?: {
	readonly cached?: string | null;
	readonly optionsSchema?: AppSchema | null;
	readonly provider?: typeof provider | null;
	readonly optionsScript?: typeof searchOptionsScript;
	readonly searchError?: "inactive_provider" | "unsupported_operation";
	readonly execute?: Execute;
	readonly searchOptionsError?:
		| "inactive_provider"
		| "unsupported_operation"
		| "script_unavailable";
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const executions = yield* Ref.make<ReadonlyArray<ExecuteInput>>([]);
			const resolutions = yield* Ref.make<ResolutionCounts>({
				search: 0,
				provider: 0,
				searchOptions: 0,
			});
			const execute = yield* Ref.make(input?.execute ?? defaultExecute);
			const cachedOptions = yield* Ref.make(input?.cached ?? null);
			const cacheWrites = yield* Ref.make(0);
			const resolve = (operation: keyof ResolutionCounts) =>
				Ref.update(resolutions, (counts) => ({ ...counts, [operation]: counts[operation] + 1 }));
			const redis =
				input?.cached === undefined
					? makeRedisService()
					: makeRedisService({
							get: () => Ref.get(cachedOptions),
							set: (_key, nextValue) =>
								Ref.set(cachedOptions, nextValue).pipe(
									Effect.andThen(Ref.update(cacheWrites, (count) => count + 1)),
								),
						});
			return ProviderEntitySearchService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						Layer.mock(PluginRuntimeResolver)({
							findProviderAvailableToUser: () =>
								resolve("provider").pipe(
									Effect.as(input?.provider === undefined ? provider : input.provider),
								),
							resolveUserSearchOptionsScript: () =>
								resolve("searchOptions").pipe(
									Effect.andThen(
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
									),
								),
							resolveUserSearchScript: () =>
								resolve("search").pipe(
									Effect.andThen(
										input?.searchError
											? Effect.fail(
													new UnsupportedProviderOperationError({
														providerId,
														operation: "search",
														reason: input.searchError,
														providerSlug: provider.slug,
													}),
												)
											: Effect.succeed({
													...searchScript,
													optionsSchema: input?.optionsSchema ?? null,
												}),
									),
								),
						}),
						Layer.mock(SandboxExecutionService)({
							executeScript: (run) =>
								Ref.update(executions, (all) => [...all, run]).pipe(
									Effect.andThen(Ref.get(execute)),
									Effect.flatMap((respond) => respond(run)),
								),
						}),
						Layer.succeed(RedisService, redis),
						Layer.succeed(FakeProviderSearch, {
							executions: Ref.get(executions),
							resolutions: Ref.get(resolutions),
							cacheWrites: Ref.get(cacheWrites),
							cachedOptions: Ref.get(cachedOptions),
							respondWith: (next) => Ref.set(execute, next),
						}),
					),
				),
			);
		}),
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

layer(
	makeLayer({
		optionsSchema,
		execute: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { items: [{ title: "Record", externalId: "search-script-id-external" }] },
			}),
	}),
)((test) => {
	test.effect("executes one provider search and returns its singular response", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const result = yield* service.search(user, {
				page: 2,
				providerId,
				pageSize: 10,
				query: "record",
				options: { passRawQuery: true },
			});

			const executions = yield* (yield* FakeProviderSearch).executions;
			expect(result).toEqual({
				providerId,
				providerName: "Records",
				rootEntitySchemaSlug: "record",
				items: [{ title: "Record", externalId: "search-script-id-external" }],
			});
			expect(executions).toHaveLength(1);
			expect(executions[0]).toMatchObject({
				scriptId: "search-script-id",
				subject: { type: "user", userId: user.id },
				input: { page: 2, pageSize: 10, query: "record", options: { passRawQuery: true } },
			});
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("returns no schema when the provider search has no options", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			expect(yield* service.resolveSearchOptionsSchema(user, providerId)).toBeNull();
		}),
	);
});

layer(makeLayer({ optionsSchema, execute: () => Effect.die("unused") }))((test) => {
	test.effect("returns static options without executing the auxiliary operation", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
			expect(schema).toEqual(optionsSchema);
			expect((yield* (yield* FakeProviderSearch).executions).length).toBe(0);
		}),
	);
});

layer(
	makeLayer({
		execute: () => Effect.die("unused"),
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
	}),
)((test) => {
	test.effect("keeps required static options validation for omitted options", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
		}),
	);
});

layer(
	makeLayer({
		cached: null,
		optionsSchema: dynamicOptionsSchema,
		execute: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { sources: { statuses: [{ value: "active", label: "Active" }] } },
			}),
	}),
)((test) => {
	test.effect("executes and materializes dynamic search options", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
			expect(schema).toMatchObject({
				fields: {
					status: { choices: { kind: "static", values: [{ value: "active", label: "Active" }] } },
				},
			});
			const executions = yield* (yield* FakeProviderSearch).executions;
			expect(executions).toHaveLength(1);
			expect(executions[0]).toMatchObject({
				input: {},
				scriptId: searchOptionsScript.id,
				subject: { type: "user", userId: user.id },
			});
		}),
	);
});

layer(
	makeLayer({
		cached: null,
		optionsSchema: dynamicOptionsSchema,
		execute: (input) =>
			input.scriptId !== searchOptionsScript.id
				? Effect.die("unexpected search execution")
				: Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { sources: { statuses: [{ value: "active" }] } },
					}),
	}),
)((test) => {
	test.effect("uses cached dynamic options without executing the auxiliary operation twice", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			yield* service.resolveSearchOptionsSchema(user, providerId);
			yield* service.resolveSearchOptionsSchema(user, providerId);
			const search = yield* FakeProviderSearch;
			expect((yield* search.executions).length).toBe(1);
			expect(yield* search.cacheWrites).toBe(1);
		}),
	);
});

layer(
	makeLayer({
		cached: "not-json",
		optionsSchema: dynamicOptionsSchema,
		execute: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { sources: { statuses: [{ value: "active" }] } },
			}),
	}),
)((test) => {
	test.effect("refreshes malformed cached dynamic options", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			expect(yield* service.resolveSearchOptionsSchema(user, providerId)).not.toBeNull();
			const search = yield* FakeProviderSearch;
			expect((yield* search.executions).length).toBe(1);
			expect(yield* search.cacheWrites).toBe(1);
		}),
	);
});

layer(
	makeLayer({
		optionsSchema: dynamicOptionsSchema,
		cached: JSON.stringify({ sources: { other: [{ value: "active" }] } }),
		execute: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { sources: { statuses: [{ value: "active", label: "Active" }] } },
			}),
	}),
)((test) => {
	test.effect("refreshes a decodable stale cache missing a required source", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const schema = yield* service.resolveSearchOptionsSchema(user, providerId);
			expect(schema).toMatchObject({
				fields: {
					status: { choices: { kind: "static", values: [{ value: "active", label: "Active" }] } },
				},
			});
			const search = yield* FakeProviderSearch;
			expect((yield* search.executions).length).toBe(1);
			expect(yield* search.cacheWrites).toBe(1);
			expect(yield* search.cachedOptions).toBe(
				'{"sources":{"statuses":[{"value":"active","label":"Active"}]}}',
			);
		}),
	);
});

layer(makeLayer({ cached: null, optionsSchema: dynamicOptionsSchema }))((test) => {
	test.effect("does not cache malformed or unmaterializable search-options results", () =>
		Effect.gen(function* () {
			const cases = [
				{ sources: { other: [{ value: "active" }] } },
				{ sources: { statuses: [{ value: "" }] } },
			];
			const search = yield* FakeProviderSearch;
			for (const value of cases) {
				yield* search.respondWith(() =>
					Effect.succeed({ value, logs: [], error: null, status: "completed" as const }),
				);
				const service = yield* ProviderEntitySearchService;
				const exit = yield* Effect.exit(service.resolveSearchOptionsSchema(user, providerId));
				assertFailureInstance(exit, ProviderEntityBadRequest);
				expect(yield* search.cacheWrites).toBe(0);
			}
		}),
	);
});

layer(
	makeLayer({
		optionsSchema: dynamicOptionsSchema,
		searchOptionsError: "unsupported_operation",
		execute: () =>
			Effect.succeed({ logs: [], error: null, value: { items: [] }, status: "completed" as const }),
	}),
)((test) => {
	test.effect("keeps plain dynamic searches available when options resolution fails", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			yield* service.search(user, { page: 1, providerId, pageSize: 20, query: "record" });
			const executions = yield* (yield* FakeProviderSearch).executions;
			expect(executions).toHaveLength(1);
			expect(executions[0]).toMatchObject({
				scriptId: searchScript.id,
				input: { query: "record" },
			});
			expect(executions[0]?.input).not.toHaveProperty("options");
		}),
	);
});

layer(makeLayer({ optionsSchema: dynamicOptionsSchema, searchOptionsError: "script_unavailable" }))(
	(test) => {
		test.effect("rejects filtered dynamic searches when options resolution fails", () =>
			Effect.gen(function* () {
				const service = yield* ProviderEntitySearchService;
				const exit = yield* Effect.exit(
					service.search(user, {
						page: 1,
						providerId,
						pageSize: 20,
						query: "record",
						options: { status: "active" },
					}),
				);
				assertFailureInstance(exit, ProviderEntityBadRequest);
			}),
		);
	},
);

const dynamicOptionsExecute: Execute = (input) =>
	Effect.succeed({
		logs: [],
		error: null,
		status: "completed" as const,
		value:
			input.scriptId === searchOptionsScript.id
				? { sources: { statuses: [{ value: "active" }] } }
				: { items: [] },
	});

layer(
	makeLayer({ cached: null, execute: dynamicOptionsExecute, optionsSchema: dynamicOptionsSchema }),
)((test) => {
	test.effect("validates dynamic option membership before provider search execution", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, {
					page: 1,
					providerId,
					pageSize: 20,
					query: "record",
					options: { status: "unknown" },
				}),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
			const executions = yield* (yield* FakeProviderSearch).executions;
			expect(executions).toHaveLength(1);
			expect(executions[0]?.scriptId).toBe(searchOptionsScript.id);
		}),
	);
});

layer(
	makeLayer({ cached: null, execute: dynamicOptionsExecute, optionsSchema: dynamicOptionsSchema }),
)((test) => {
	test.effect("resolves the provider and search script once for a filtered dynamic search", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			yield* service.search(user, {
				page: 1,
				providerId,
				pageSize: 20,
				query: "record",
				options: { status: "active" },
			});
			expect(yield* (yield* FakeProviderSearch).resolutions).toEqual({
				search: 1,
				provider: 1,
				searchOptions: 1,
			});
		}),
	);
});

layer(
	makeLayer({
		optionsSchema,
		execute: () =>
			Effect.succeed({ logs: [], error: null, value: { items: [] }, status: "completed" as const }),
	}),
)((test) => {
	test.effect("rejects invalid provider search options before execution", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, {
					page: 1,
					providerId,
					pageSize: 20,
					query: "record",
					options: { passRawQuery: "yes" },
				}),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
			expect((yield* (yield* FakeProviderSearch).executions).length).toBe(0);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("rejects options when the provider operation has no options schema", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, options: {}, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
		}),
	);
});

layer(makeLayer({ provider: null }))((test) => {
	test.effect("rejects a missing provider", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityNotFound);
		}),
	);
});

layer(makeLayer({ searchError: "inactive_provider" }))((test) => {
	test.effect("rejects an inactive provider", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityNotFound);
		}),
	);
});

layer(makeLayer({ searchError: "unsupported_operation" }))((test) => {
	test.effect("rejects a provider without a search operation", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
		}),
	);
});

layer(
	makeLayer({
		execute: () =>
			Effect.succeed({
				logs: [],
				value: null,
				status: "completed" as const,
				error: {
					phase: "execute" as const,
					kind: "script-failure" as const,
					message: "provider unavailable",
				},
			}),
	}),
)((test) => {
	test.effect("fails the whole request when provider execution fails", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
		}),
	);
});

layer(
	makeLayer({
		execute: () =>
			Effect.succeed({
				logs: [],
				error: null,
				value: { items: [{}] },
				status: "completed" as const,
			}),
	}),
)((test) => {
	test.effect("fails the whole request when provider output cannot be decoded", () =>
		Effect.gen(function* () {
			const service = yield* ProviderEntitySearchService;
			const exit = yield* Effect.exit(
				service.search(user, { page: 1, providerId, pageSize: 20, query: "record" }),
			);
			assertFailureInstance(exit, ProviderEntityBadRequest);
		}),
	);
});
