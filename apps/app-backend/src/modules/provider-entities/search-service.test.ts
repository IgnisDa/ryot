import { assert, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { dbRunnerLayer } from "#lib/test-utils/effect";
import {
	PluginRuntimeResolver,
	UnsupportedProviderOperationError,
} from "#modules/plugins/runtime-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProviderEntitySearchService } from "./search-service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const providerId = SandboxProviderId.make("provider-1");
const provider = {
	name: "Books",
	id: providerId,
	pluginSlug: "books",
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

const searchScript = {
	providerId,
	source: "source",
	compiledFormat: 1,
	pluginSlug: "books",
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

const makeLayer = (input?: {
	readonly optionsSchema?: AppSchema | null;
	readonly provider?: typeof provider | null;
	readonly searchError?: "inactive_provider" | "unsupported_operation";
	readonly execute?: SandboxExecutionService["Service"]["executeScript"];
}) =>
	ProviderEntitySearchService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
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
				}),
				Layer.mock(SandboxExecutionService)({
					executeScript:
						input?.execute ??
						((run) =>
							Effect.succeed({
								logs: [],
								error: null,
								status: "completed" as const,
								value: {
									items: [
										{
											externalId: `${run.scriptId}-external`,
											titleProperty: { kind: "text", value: "Book" },
										},
									],
								},
							})),
				}),
			),
		),
	);

const assertFailureInstance = <A, E>(
	exit: Exit.Exit<A, E>,
	error: typeof BadRequest | typeof NotFound,
) => {
	assert(Exit.isFailure(exit));
	const failure = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(failure));
	expect(failure.value).toBeInstanceOf(error);
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
			items: [
				{ externalId: "search-script-id-external", titleProperty: { kind: "text", value: "Book" } },
			],
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
						value: {
							items: [
								{
									externalId: "search-script-id-external",
									titleProperty: { kind: "text", value: "Book" },
								},
							],
						},
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
		assertFailureInstance(exit, BadRequest);
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
		assertFailureInstance(exit, BadRequest);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("rejects a missing provider", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, NotFound);
	}).pipe(Effect.provide(makeLayer({ provider: null }))),
);

it.effect("rejects an inactive provider", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, NotFound);
	}).pipe(Effect.provide(makeLayer({ searchError: "inactive_provider" }))),
);

it.effect("rejects a provider without a search operation", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { providerId, query: "book", page: 1, pageSize: 20 }),
		);
		assertFailureInstance(exit, BadRequest);
	}).pipe(Effect.provide(makeLayer({ searchError: "unsupported_operation" }))),
);

it.effect("fails the whole request when provider execution fails", () =>
	Effect.gen(function* () {
		const service = yield* ProviderEntitySearchService;
		const exit = yield* Effect.exit(
			service.search(user, { page: 1, providerId, pageSize: 20, query: "book" }),
		);
		assertFailureInstance(exit, BadRequest);
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
		assertFailureInstance(exit, BadRequest);
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
