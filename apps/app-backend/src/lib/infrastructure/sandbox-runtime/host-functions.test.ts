import { expect, it } from "@effect/vitest";
import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import {
	EntitySchemaSlug,
	IntegrationId,
	RelationshipId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { ChangeUserRelationshipBatch } from "@ryot/sandbox-sdk/core";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { Effect, Either, Layer, Option, Redacted } from "effect";
import { describe } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	transactionLayer,
} from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { getSandboxAppConfigValue } from "./app-config";
import {
	makeAdditionalSandboxApiFunctions,
	normalizePreferences,
	toSandboxCreateEventsResult,
} from "./host-functions";
import { selectSandboxHostFunctions } from "./service";
import type { SandboxRunInput } from "./shared";

const config = {
	port: 8000,
	nodeEnv: "test",
	books: { googleBooksApiKey: Option.none() },
	animeAndManga: { malClientId: Option.some("mal-client") },
	videoGames: { giantBombApiKey: Option.some(Redacted.make("giant-secret")) },
};

const runEither = (key: string, scriptIsBuiltin: boolean) =>
	Effect.either(
		getSandboxAppConfigValue(config, key, { scriptIsBuiltin, requiredAppConfigKeys: [] }),
	);

describe("getSandboxAppConfigValue", () => {
	it.effect("reads non-sensitive app config values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("animeAndManga.malClientId", false);

			expect(Either.getOrThrow(result)).toBe("mal-client");
		}),
	);

	it.effect("rejects host environment keys", () =>
		Effect.gen(function* () {
			const result = yield* runEither("PATH", false);

			expect(Either.getLeft(result)).toEqual(Option.some('Config key "PATH" does not exist'));
		}),
	);

	it.effect("rejects sensitive config values for user scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("videoGames.giantBombApiKey", false);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "videoGames.giantBombApiKey" is sensitive'),
			);
		}),
	);

	it.effect("allows sensitive config values for builtin scripts", () =>
		Effect.gen(function* () {
			const result = yield* runEither("videoGames.giantBombApiKey", true);

			expect(Either.getOrThrow(result)).toBe("giant-secret");
		}),
	);

	it.effect("rejects unconfigured optional values", () =>
		Effect.gen(function* () {
			const result = yield* runEither("books.googleBooksApiKey", true);

			expect(Either.getLeft(result)).toEqual(
				Option.some('Config key "books.googleBooksApiKey" is not configured'),
			);
		}),
	);
});

describe("normalizePreferences", () => {
	it("normalizes missing and non-boolean preference values", () => {
		expect(normalizePreferences(null)).toEqual({
			isNsfw: false,
			disableIntegrations: false,
		});
		expect(normalizePreferences({ isNsfw: 1, disableIntegrations: true })).toEqual({
			isNsfw: false,
			disableIntegrations: true,
		});
	});
});

type GetForUserInput = { readonly integrationId: IntegrationId; readonly userId: UserId };

const ownedIntegration = (input: GetForUserInput): IntegrationRecord => ({
	name: null,
	lot: "yank",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	userId: input.userId,
	syncOwnership: false,
	provider: "plex_yank",
	id: input.integrationId,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	extraSettings: { disableOnContinuousErrors: false },
	providerSpecifics: { kind: "plex_yank", token: "plex-token", baseUrl: "https://plex.example" },
});

const runInput = (authority: ExecutionAuthority): SandboxRunInput => ({
	authority,
	context: {},
	metadata: {},
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	scriptIsBuiltin: false,
	allowedHostFunctions: [],
	executionId: "execution-1",
	cacheNamespace: "script-1",
});

const subscriptionAuthority = (
	origin: Extract<ExecutionAuthority, { type: "subscription" }>["subscriptionRun"]["origin"],
) =>
	({
		type: "subscription",
		userId: UserId.make("user-1"),
		subscriptionRun: {
			origin,
			id: SubscriptionRunId.make("run-1"),
			occurredAt: "2026-01-01T00:00:00.000Z",
		},
	}) satisfies ExecutionAuthority;

const runGetIntegration = (
	authority: ExecutionAuthority,
	getForUser: (input: GetForUserInput) => Effect.Effect<IntegrationRecord | null>,
) =>
	makeAdditionalSandboxApiFunctions().pipe(
		Effect.flatMap((functions) => Effect.either(functions.getIntegration(runInput(authority)))),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({ _tag: "EventsService" }),
				Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
				Layer.mock(EntitiesRepository)({ _tag: "EntitiesRepository" }),
				Layer.mock(QueryEngineService)({ _tag: "QueryEngineService" }),
				Layer.succeed(DefinitionRegistry, {
					_tag: "DefinitionRegistry",
					...makeDefinitionRegistry(),
				}),
				Layer.mock(PluginRuntimeResolver)({ _tag: "PluginRuntimeResolver" }),
				Layer.mock(RelationshipsRepository)({ _tag: "RelationshipsRepository" }),
				Layer.mock(IntegrationsRepository)({ _tag: "IntegrationsRepository", getForUser }),
			),
		),
	);

describe("getIntegration", () => {
	it.effect("resolves the integration the operation execution was dispatched for", () =>
		Effect.gen(function* () {
			const requested: GetForUserInput[] = [];
			const result = yield* runGetIntegration(
				{
					type: "user",
					userId: UserId.make("user-1"),
					integrationId: IntegrationId.make("int-trusted"),
				},
				(input) => {
					requested.push(input);
					return Effect.succeed(ownedIntegration(input));
				},
			);

			expect(requested).toEqual([{ integrationId: "int-trusted", userId: "user-1" }]);
			const integration = Either.getOrThrow(result);
			expect(integration.id).toBe("int-trusted");
			expect(integration.providerSpecifics).toEqual({
				kind: "plex_yank",
				token: "plex-token",
				baseUrl: "https://plex.example",
			});
		}),
	);

	it.effect("resolves the integration a subscription execution originated from", () =>
		Effect.gen(function* () {
			const requested: GetForUserInput[] = [];
			const result = yield* runGetIntegration(
				subscriptionAuthority({
					kind: "integration",
					integrationId: IntegrationId.make("int-origin"),
				}),
				(input) => {
					requested.push(input);
					return Effect.succeed(ownedIntegration(input));
				},
			);

			expect(requested).toEqual([{ integrationId: "int-origin", userId: "user-1" }]);
			expect(Either.getOrThrow(result).id).toBe("int-origin");
		}),
	);

	it.effect("fails when the execution has no integration in scope", () =>
		Effect.forEach(
			[
				{ type: "user", userId: UserId.make("user-1") },
				subscriptionAuthority({ kind: "api" }),
			] satisfies ExecutionAuthority[],
			(authority) =>
				Effect.gen(function* () {
					const result = yield* runGetIntegration(authority, () =>
						Effect.die("must not reach the repository"),
					);

					expect(Either.getLeft(result)).toEqual(
						Option.some({
							message: "getIntegration is available only to executions scoped to an integration",
						}),
					);
				}),
		),
	);

	it.effect("keeps the executing user's ownership scope", () =>
		Effect.gen(function* () {
			const result = yield* runGetIntegration(
				{
					type: "user",
					userId: UserId.make("user-1"),
					integrationId: IntegrationId.make("int-of-another-user"),
				},
				() => Effect.succeed(null),
			);

			expect(Either.getLeft(result)).toEqual(Option.some({ message: "Integration not found" }));
		}),
	);
});

const queryDocument = {
	source: { type: "entities", alias: "entity", schemas: ["media"], where: null },
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
	},
} as const satisfies JsonValue;

const queryResponse = {
	type: "rows" as const,
	data: { items: [], pageInfo: { page: 1, limit: 10, total: 0, hasMore: false } },
};

const executeQueryEngine = () => Effect.void;

const systemQueryCaller = {
	eventSchemas: [],
	entitySchemaSlugs: ["media"],
	pluginSlug: "media",
	relationshipSchemaSlugs: ["media-monitoring"],
};

const runExecuteQueryEngine = (input: SandboxRunInput, caller: typeof systemQueryCaller | null) => {
	const userCalls: unknown[] = [];
	const systemCalls: unknown[] = [];
	const resolvedScriptIds: string[] = [];
	return makeAdditionalSandboxApiFunctions().pipe(
		Effect.flatMap((functions) =>
			Effect.either(functions.executeQueryEngine(input, queryDocument)),
		),
		Effect.map((result) => ({ result, resolvedScriptIds, systemCalls, userCalls })),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({ _tag: "EventsService" }),
				Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
				Layer.mock(EntitiesRepository)({ _tag: "EntitiesRepository" }),
				Layer.mock(IntegrationsRepository)({ _tag: "IntegrationsRepository" }),
				Layer.mock(RelationshipsRepository)({ _tag: "RelationshipsRepository" }),
				Layer.succeed(DefinitionRegistry, {
					_tag: "DefinitionRegistry",
					...makeDefinitionRegistry(),
				}),
				Layer.mock(PluginRuntimeResolver)({
					_tag: "PluginRuntimeResolver",
					resolveSystemQueryActivity: (scriptId) => {
						resolvedScriptIds.push(scriptId);
						return Effect.succeed(caller);
					},
				}),
				Layer.mock(QueryEngineService)({
					_tag: "QueryEngineService",
					executeSystem: (scope, doc) => {
						systemCalls.push({ scope, doc });
						return Effect.succeed(queryResponse);
					},
					executeForUser: (userId, language, doc) => {
						userCalls.push({ userId, language, doc });
						return Effect.succeed(queryResponse);
					},
				}),
			),
		),
	);
};

describe("executeQueryEngine", () => {
	it.effect("derives system scope from the persisted activity script identity", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteQueryEngine(
				{ ...runInput({ type: "system" }), metadata: { kind: "activity" } },
				systemQueryCaller,
			);

			expect(Either.getOrThrow(execution.result)).toEqual(queryResponse);
			expect(execution.resolvedScriptIds).toEqual(["script-1"]);
			expect(execution.systemCalls).toEqual([{ scope: systemQueryCaller, doc: queryDocument }]);
			expect(execution.userCalls).toEqual([]);
		}),
	);

	it.effect("rejects system access when persisted identity is not a pinned plugin activity", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteQueryEngine(
				{ ...runInput({ type: "system" }), metadata: { kind: "activity" } },
				null,
			);

			expect(Either.getLeft(execution.result)).toEqual(
				Option.some({
					message: "executeQueryEngine system access requires a pinned plugin activity script",
				}),
			);
			expect(execution.systemCalls).toEqual([]);
		}),
	);

	it.effect(
		"keeps direct and delegated user execution in user scope without a synthetic user",
		() =>
			Effect.gen(function* () {
				const execution = yield* runExecuteQueryEngine(
					runInput(subscriptionAuthority({ kind: "api" })),
					null,
				);

				expect(Either.getOrThrow(execution.result)).toEqual(queryResponse);
				expect(execution.resolvedScriptIds).toEqual([]);
				expect(execution.systemCalls).toEqual([]);
				expect(execution.userCalls).toEqual([
					{ userId: "user-1", language: null, doc: queryDocument },
				]);
			}),
	);

	it("exposes system query execution only to workflow activities while preserving user access", () => {
		const bound = { executeQueryEngine };
		const systemScript = selectSandboxHostFunctions(bound, {
			metadata: { kind: "script" },
			authority: { type: "system" },
			allowedHostFunctions: ["executeQueryEngine"],
		});
		const systemActivity = selectSandboxHostFunctions(bound, {
			authority: { type: "system" },
			metadata: { kind: "activity" },
			allowedHostFunctions: ["executeQueryEngine"],
		});
		const user = selectSandboxHostFunctions(bound, {
			metadata: { kind: "operation" },
			allowedHostFunctions: ["executeQueryEngine"],
			authority: { type: "user", userId: UserId.make("user-1") },
		});

		expect(systemScript).toEqual({});
		expect(systemActivity).toEqual({ executeQueryEngine });
		expect(user).toEqual({ executeQueryEngine });
	});
});

const runChangeUserRelationships = (
	authority: ExecutionAuthority,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
	repository: Layer.Layer<RelationshipsRepository>,
) =>
	makeAdditionalSandboxApiFunctions().pipe(
		Effect.flatMap((functions) =>
			Effect.either(functions.changeUserRelationships(runInput(authority), batches)),
		),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({ _tag: "EventsService" }),
				Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
				Layer.mock(QueryEngineService)({ _tag: "QueryEngineService" }),
				Layer.mock(PluginRuntimeResolver)({ _tag: "PluginRuntimeResolver" }),
				Layer.mock(IntegrationsRepository)({ _tag: "IntegrationsRepository" }),
				repository,
				Layer.succeed(DefinitionRegistry, {
					_tag: "DefinitionRegistry",
					...makeDefinitionRegistry(),
				}),
				Layer.mock(EntitiesRepository)({
					_tag: "EntitiesRepository",
					getEntityScopeForUser: ({ entityId }) =>
						Effect.succeed({
							entityId,
							isBuiltin: true,
							entityName: "Entity",
							entityUserId: null,
							entitySchemaSlug: EntitySchemaSlug.make(
								entityId === "collection-1" ? "collection" : "entity",
							),
						}),
				}),
			),
		),
	);

describe("changeUserRelationships", () => {
	const identity = {
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		relationshipSchemaSlug: "member-of",
	};
	const batch = { deletes: [], creates: [{ ...identity, properties: {} }] };

	it.effect("derives the relationship owner from direct user authority", () => {
		const created: unknown[] = [];
		const repository = Layer.mock(RelationshipsRepository)({
			_tag: "RelationshipsRepository",
			createRelationship: (input) => {
				created.push(input);
				return Effect.succeed({
					...input,
					wasInserted: true,
					createdAt: "2026-07-28T00:00:00.000Z",
					id: RelationshipId.make("relationship-1"),
				});
			},
		});

		return Effect.gen(function* () {
			const result = yield* runChangeUserRelationships(
				{ type: "user", userId: UserId.make("trusted-user") },
				[batch],
				repository,
			);

			expect(Either.getOrThrow(result)).toEqual([{ created: 1, deleted: 0 }]);
			expect(created).toEqual([
				{
					scope: "user",
					userId: "trusted-user",
					properties: { rank: 0 },
					sourceEntityId: "entity-1",
					targetEntityId: "collection-1",
					relationshipSchemaSlug: "member-of",
				},
			]);
		});
	});

	it.effect("rejects delegated user authority and total change overflow before writing", () => {
		let writes = 0;
		const repository = Layer.mock(RelationshipsRepository)({
			_tag: "RelationshipsRepository",
			createRelationship: () => {
				writes += 1;
				return Effect.die("must not write");
			},
		});
		const overflow = Array.from({ length: 501 }, () => identity);

		return Effect.gen(function* () {
			const delegated = yield* runChangeUserRelationships(
				subscriptionAuthority({ kind: "api" }),
				[batch],
				repository,
			);
			const tooMany = yield* runChangeUserRelationships(
				{ type: "user", userId: UserId.make("trusted-user") },
				[{ creates: [], deletes: overflow }],
				repository,
			);

			expect(Either.getLeft(delegated)).toEqual(
				Option.some({ message: "changeUserRelationships is available only to user executions" }),
			);
			expect(Either.getLeft(tooMany)).toEqual(
				Option.some({ message: "changeUserRelationships exceeds 500 changes" }),
			);
			expect(writes).toBe(0);
		});
	});
});

describe("toSandboxCreateEventsResult", () => {
	it.effect("preserves policy failures at the sandbox host boundary", () =>
		Effect.gen(function* () {
			const result = yield* Effect.either(
				toSandboxCreateEventsResult({
					count: 0,
					outcomes: [],
					failure: { index: 0, reason: { kind: "bad_request", message: "Policy failed" } },
				}),
			);

			expect(Either.getLeft(result)).toEqual(Option.some("Policy failed"));
		}),
	);
});
