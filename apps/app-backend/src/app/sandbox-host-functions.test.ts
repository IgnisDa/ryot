import { expect, it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { ChangeUserRelationshipBatch } from "@ryot/sandbox-sdk/core";
import { Effect, Result, Layer, Option } from "effect";
import { describe } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import { selectSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
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
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";

import {
	makeAdditionalSandboxApiFunctions,
	normalizePreferences,
	toSandboxCreateEventsResult,
} from "./sandbox-host-functions";

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
	pluginSlug: "fixture",
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
	contentHash: "",
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	allowedHostFunctions: [],
	executionId: "execution-1",
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

const runGetCurrentIntegration = (
	authority: ExecutionAuthority,
	getForUser: (input: GetForUserInput) => Effect.Effect<IntegrationRecord | null>,
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.getCurrentIntegration(runInput(authority))),
		),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(RyotQLService)({}),
				Layer.succeed(DefinitionRegistry, {
					...makeDefinitionRegistry(),
				}),
				Layer.mock(PluginRuntimeResolver)({}),
				Layer.mock(RelationshipsRepository)({}),
				Layer.mock(IntegrationsRepository)({ getForUser }),
			),
		),
	);

const executeRyotql = () => Effect.void;

describe("getCurrentIntegration", () => {
	it.effect("resolves the integration the operation execution was dispatched for", () =>
		Effect.gen(function* () {
			const requested: GetForUserInput[] = [];
			const result = yield* runGetCurrentIntegration(
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
			const integration = Result.getOrThrow(result);
			expect(integration.id).toBe("int-trusted");
			expect(integration).not.toHaveProperty("pluginSlug");
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
			const result = yield* runGetCurrentIntegration(
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
			expect(Result.getOrThrow(result).id).toBe("int-origin");
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
					const result = yield* runGetCurrentIntegration(authority, () =>
						Effect.die("must not reach the repository"),
					);

					expect(Result.getFailure(result)).toEqual(
						Option.some({
							message:
								"getCurrentIntegration is available only to executions scoped to an integration",
						}),
					);
				}),
		),
	);

	it.effect("keeps the executing user's ownership scope", () =>
		Effect.gen(function* () {
			const result = yield* runGetCurrentIntegration(
				{
					type: "user",
					userId: UserId.make("user-1"),
					integrationId: IntegrationId.make("int-of-another-user"),
				},
				() => Effect.succeed(null),
			);

			expect(Result.getFailure(result)).toEqual(Option.some({ message: "Integration not found" }));
		}),
	);
});

const ryotqlDocument = {
	queries: {
		entities: {
			from: { table: "entity", alias: "entity" },
			output: { fields: [], orderBy: [], type: "rows", pagination: { page: 1, limit: 10 } },
		},
	},
} as const satisfies RyotQLDocument;

const ryotqlResponse = {
	data: {
		entities: {
			items: [],
			type: "rows" as const,
			pageInfo: { page: 1, limit: 10, total: 0, hasMore: false },
		},
	},
};

const systemPluginScope = {
	eventSchemas: [],
	pluginSlug: "media",
	entitySchemaSlugs: ["media"],
	relationshipSchemaSlugs: ["media-monitoring"],
};

const runExecuteRyotql = (
	input: SandboxRunInput,
	caller: typeof systemPluginScope | null,
	document: RyotQLDocument = ryotqlDocument,
) => {
	const userCalls: unknown[] = [];
	const pluginCalls: unknown[] = [];
	const resolvedScriptIds: string[] = [];
	return makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) => Effect.result(functions.executeRyotql(input, document))),
		Effect.map((result) => ({ result, resolvedScriptIds, pluginCalls, userCalls })),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(IntegrationsRepository)({}),
				Layer.mock(RelationshipsRepository)({}),
				Layer.succeed(DefinitionRegistry, makeDefinitionRegistry()),
				Layer.mock(PluginRuntimeResolver)({
					resolveSystemQueryScript: (scriptId) => {
						resolvedScriptIds.push(scriptId);
						return Effect.succeed(caller);
					},
				}),
				Layer.mock(RyotQLService)({
					executeForPlugin: (scope, doc) => {
						pluginCalls.push({ scope, document: doc });
						return Effect.succeed(ryotqlResponse);
					},
					executeForUser: (userId, language, doc) => {
						userCalls.push({ userId, language, document: doc });
						return Effect.succeed(ryotqlResponse);
					},
				}),
			),
		),
	);
};

describe("executeRyotql", () => {
	it.effect("derives plugin scope from the persisted plugin script identity", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql(
				{ ...runInput({ type: "system" }), metadata: { kind: "script" } },
				systemPluginScope,
			);

			expect(Result.getOrThrow(execution.result)).toEqual(ryotqlResponse);
			expect(execution.resolvedScriptIds).toEqual(["script-1"]);
			expect(execution.pluginCalls).toEqual([
				{
					document: ryotqlDocument,
					scope: {
						eventSchemas: [],
						pluginSlug: "media",
						entitySchemaSlugs: ["media"],
						relationshipSchemaSlugs: ["media-monitoring"],
					},
				},
			]);
			expect(execution.userCalls).toEqual([]);
		}),
	);

	it.effect("keeps delegated execution in user scope", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql(
				runInput(subscriptionAuthority({ kind: "api" })),
				null,
			);

			expect(Result.getOrThrow(execution.result)).toEqual(ryotqlResponse);
			expect(execution.resolvedScriptIds).toEqual([]);
			expect(execution.pluginCalls).toEqual([]);
			expect(execution.userCalls).toEqual([
				{ userId: "user-1", language: null, document: ryotqlDocument },
			]);
		}),
	);

	it.effect("rejects unpinned system execution", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql(
				{ ...runInput({ type: "system" }), metadata: { kind: "script" } },
				null,
			);

			expect(Result.getFailure(execution.result)).toEqual(
				Option.some({
					message: "executeRyotql system access requires a pinned plugin script",
				}),
			);
			expect(execution.pluginCalls).toEqual([]);
		}),
	);

	it.effect("rejects caller-supplied execution scope in the document", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql(
				runInput({ type: "user", userId: UserId.make("user-1") }),
				null,
				{ ...ryotqlDocument, scope: "plugin" } as unknown as RyotQLDocument,
			);

			expect(Option.getOrThrow(Result.getFailure(execution.result))).toMatchObject({
				message: expect.stringContaining("scope"),
			});
			expect(execution.userCalls).toEqual([]);
		}),
	);

	it("gates RyotQL by the declared capability", () => {
		const bound = { executeRyotql };
		const selected = selectSandboxHostFunctions(bound, {
			metadata: { kind: "script" },
			authority: { type: "system" },
			allowedHostFunctions: ["executeRyotql"],
		});

		expect(selected).toEqual({ executeRyotql });
	});
});

const runChangeUserRelationships = (
	authority: ExecutionAuthority,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
	repository: Layer.Layer<RelationshipsRepository>,
	getEntityScopeForUser: (input: { userId: UserId; entityId: EntityId }) => Effect.Effect<{
		entityId: EntityId;
		isBuiltin: boolean;
		entityName: string;
		entityUserId: UserId | null;
		entitySchemaSlug: EntitySchemaSlug;
	} | null> = ({ entityId }) =>
		Effect.succeed({
			entityId,
			isBuiltin: true,
			entityUserId: null,
			entityName: "Entity",
			entitySchemaSlug: EntitySchemaSlug.make(
				entityId === "collection-1" ? "collection" : "entity",
			),
		}),
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.changeUserRelationships(runInput(authority), batches)),
		),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(RyotQLService)({}),
				Layer.mock(PluginRuntimeResolver)({}),
				Layer.mock(IntegrationsRepository)({}),
				repository,
				Layer.succeed(DefinitionRegistry, { ...makeDefinitionRegistry() }),
				Layer.mock(EntitiesRepository)({ getEntityScopeForUser }),
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

			expect(Result.getOrThrow(result)).toEqual([{ created: 1, deleted: 0 }]);
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

	it.effect("derives the relationship owner from subscription authority", () => {
		const created: unknown[] = [];
		const repository = Layer.mock(RelationshipsRepository)({
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
				subscriptionAuthority({ kind: "api" }),
				[batch],
				repository,
			);

			expect(Result.getOrThrow(result)).toEqual([{ created: 1, deleted: 0 }]);
			expect(created).toEqual([
				{
					scope: "user",
					userId: "user-1",
					properties: { rank: 0 },
					sourceEntityId: "entity-1",
					targetEntityId: "collection-1",
					relationshipSchemaSlug: "member-of",
				},
			]);
		});
	});

	it.effect("brands deleted relationship identities before writing", () => {
		const deleted: unknown[] = [];
		const repository = Layer.mock(RelationshipsRepository)({
			deleteRelationship: (input) => {
				deleted.push(input);
				return Effect.succeed(null);
			},
		});

		return Effect.gen(function* () {
			const result = yield* runChangeUserRelationships(
				{ type: "user", userId: UserId.make("trusted-user") },
				[{ creates: [], deletes: [identity] }],
				repository,
			);

			expect(Result.getOrThrow(result)).toEqual([{ created: 0, deleted: 0 }]);
			expect(deleted).toEqual([
				{
					scope: "user",
					userId: "trusted-user",
					sourceEntityId: "entity-1",
					targetEntityId: "collection-1",
					relationshipSchemaSlug: "member-of",
				},
			]);
		});
	});

	it.effect("rejects a subscription relationship with an endpoint invisible to its user", () => {
		let writes = 0;
		const repository = Layer.mock(RelationshipsRepository)({
			createRelationship: () => {
				writes += 1;
				return Effect.die("must not write");
			},
		});

		return Effect.gen(function* () {
			const result = yield* runChangeUserRelationships(
				subscriptionAuthority({ kind: "api" }),
				[batch],
				repository,
				({ entityId, userId }) =>
					entityId === "collection-1" && userId === "user-1"
						? Effect.succeed(null)
						: Effect.succeed({
								entityId,
								isBuiltin: true,
								entityUserId: null,
								entityName: "Entity",
								entitySchemaSlug: EntitySchemaSlug.make("entity"),
							}),
			);

			expect(Result.getFailure(result)).toMatchObject(
				Option.some({ _tag: "NotFound", message: "Entity not found" }),
			);
			expect(writes).toBe(0);
		});
	});

	it.effect("rejects system authority and total change overflow before writing", () => {
		let writes = 0;
		const repository = Layer.mock(RelationshipsRepository)({
			createRelationship: () => {
				writes += 1;
				return Effect.die("must not write");
			},
		});
		const overflow = Array.from({ length: 501 }, () => identity);

		return Effect.gen(function* () {
			const system = yield* runChangeUserRelationships({ type: "system" }, [batch], repository);
			const tooMany = yield* runChangeUserRelationships(
				{ type: "user", userId: UserId.make("trusted-user") },
				[{ creates: [], deletes: overflow }],
				repository,
			);

			expect(Result.getFailure(system)).toEqual(
				Option.some({ message: "changeUserRelationships is not available for system executions" }),
			);
			expect(Result.getFailure(tooMany)).toEqual(
				Option.some({ message: "changeUserRelationships exceeds 500 changes" }),
			);
			expect(writes).toBe(0);
		});
	});
});

const runEnsureUserEntities = (options: {
	schemaPluginSlug?: string;
	authority: ExecutionAuthority;
	caller: { pluginSlug: string; entitySchemaSlugs: string[] } | null;
	ensure?: (
		userId: UserId,
		items: ReadonlyArray<{ name: string; properties: unknown; entitySchemaSlug: EntitySchemaSlug }>,
	) => Effect.Effect<Array<{ entityId: EntityId; wasInserted: boolean }>>;
}) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.ensureUserEntities(runInput(options.authority), [
					{ name: "Workspace", properties: {}, entitySchemaSlug: "workspace" },
				]),
			),
		),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(RyotQLService)({}),
				Layer.mock(IntegrationsRepository)({}),
				Layer.mock(RelationshipsRepository)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(EntitiesService)({
					ensureUserEntities:
						options.ensure ??
						(() =>
							Effect.succeed([{ entityId: EntityId.make("workspace-id"), wasInserted: true }])),
				}),
				Layer.mock(PluginRuntimeResolver)({
					resolveTrustedUserBootstrapCaller: () => Effect.succeed(options.caller),
				}),
				Layer.succeed(DefinitionRegistry, {
					...makeDefinitionRegistry(),
					getEntitySchema: () => ({
						icon: "box",
						eventSchemas: {},
						slug: "workspace",
						name: "Workspace",
						accentColor: "blue",
						mergeIdentityProperties: [],
						propertiesSchema: { fields: {} },
						pluginSlug: options.schemaPluginSlug ?? "media",
					}),
				}),
			),
		),
	);

describe("ensureUserEntities", () => {
	it.effect("binds the direct user and preserves first-create/idempotent results", () => {
		const calls: Array<unknown> = [];
		let attempt = 0;
		return Effect.gen(function* () {
			const run = () =>
				runEnsureUserEntities({
					authority: { type: "user", userId: UserId.make("trusted-user") },
					caller: { pluginSlug: "media", entitySchemaSlugs: ["workspace"] },
					ensure: (userId, items) => {
						calls.push({ userId, items });
						attempt += 1;
						return Effect.succeed([
							{ entityId: EntityId.make("workspace-id"), wasInserted: attempt === 1 },
						]);
					},
				});
			expect(Result.getOrThrow(yield* run())).toEqual([
				{ entityId: "workspace-id", wasInserted: true },
			]);
			expect(Result.getOrThrow(yield* run())).toEqual([
				{ entityId: "workspace-id", wasInserted: false },
			]);
			expect(calls).toEqual([
				{
					userId: "trusted-user",
					items: [{ name: "Workspace", properties: {}, entitySchemaSlug: "workspace" }],
				},
				{
					userId: "trusted-user",
					items: [{ name: "Workspace", properties: {}, entitySchemaSlug: "workspace" }],
				},
			]);
		});
	});

	it.effect("rejects delegated, system, untrusted, and foreign-schema executions", () =>
		Effect.gen(function* () {
			const trusted = { pluginSlug: "media", entitySchemaSlugs: ["workspace"] };
			const delegated = yield* runEnsureUserEntities({
				caller: trusted,
				authority: subscriptionAuthority({ kind: "api" }),
			});
			const system = yield* runEnsureUserEntities({
				caller: trusted,
				authority: { type: "system" },
			});
			const untrusted = yield* runEnsureUserEntities({
				caller: null,
				authority: { type: "user", userId: UserId.make("user-1") },
			});
			const foreign = yield* runEnsureUserEntities({
				caller: trusted,
				schemaPluginSlug: "fitness",
				authority: { type: "user", userId: UserId.make("user-1") },
			});

			expect(Result.getFailure(delegated)).toEqual(
				Option.some({ message: "ensureUserEntities is available only to user executions" }),
			);
			expect(Result.getFailure(system)).toEqual(
				Option.some({ message: "ensureUserEntities is not available for system executions" }),
			);
			expect(Result.getFailure(untrusted)).toEqual(
				Option.some({
					message: "ensureUserEntities is available only to trusted user bootstrap scripts",
				}),
			);
			expect(Result.getFailure(foreign)).toEqual(
				Option.some({
					message: "ensureUserEntities cannot write foreign entity schema: workspace",
				}),
			);
		}),
	);
});

describe("toSandboxCreateEventsResult", () => {
	it.effect("preserves policy failures at the sandbox host boundary", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(
				toSandboxCreateEventsResult({
					count: 0,
					outcomes: [],
					failure: { index: 0, reason: { kind: "bad_request", message: "Policy failed" } },
				}),
			);

			expect(Result.getFailure(result)).toEqual(Option.some("Policy failed"));
		}),
	);
});
