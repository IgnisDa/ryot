import { expect, it } from "@effect/vitest";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	IntegrationId,
	RelationshipId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { ChangeUserRelationshipBatch } from "@ryot-app/sandbox-sdk/core";
import { Effect, Result, Layer, Option } from "effect";
import { describe } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { selectSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
import { databaseLayer, makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";
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
} from "./host-functions";

describe("normalizePreferences", () => {
	it("normalizes missing and non-boolean preference values", () => {
		expect(normalizePreferences(null)).toEqual({ allowNsfw: false, disableIntegrations: false });
		expect(normalizePreferences({ allowNsfw: 1, disableIntegrations: true })).toEqual({
			allowNsfw: false,
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
	provider: "lambda_yank",
	pluginSlug: "fixture",
	id: input.integrationId,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	pluginInstallationId: "example-installation",
	extraSettings: { disableOnContinuousErrors: false },
	providerSpecifics: {
		kind: "lambda_yank",
		token: "lambda-token",
		baseUrl: "https://lambda.example",
	},
});

const runInput = (
	subject: SandboxExecutionSubject,
	capabilities: readonly string[] = [],
	principalFacts: Partial<SandboxExecutionPrincipal> = {},
): SandboxRunInput => ({
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: "execution-1",
	principal: {
		subject,
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "script",
		metadata: { capabilities: [...capabilities] },
		scriptId: SandboxScriptId.make("script-1"),
		...principalFacts,
	},
});

const subscriptionSubject = (
	origin: Extract<SandboxExecutionSubject, { type: "subscription" }>["subscriptionRun"]["origin"],
) =>
	({
		type: "subscription",
		userId: UserId.make("user-1"),
		subscriptionRun: {
			origin,
			occurredAt: "2026-01-01T00:00:00.000Z",
			id: SubscriptionRunId.make("run-1"),
		},
	}) satisfies SandboxExecutionSubject;

const runGetCurrentIntegration = (
	subject: SandboxExecutionSubject,
	getForUser: (input: GetForUserInput) => Effect.Effect<IntegrationRecord | null>,
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.getCurrentIntegration(runInput(subject))),
		),
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(RyotQLService)({}),
				Layer.succeed(DefinitionRegistry, { ...makeDefinitionRegistry() }),
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
				kind: "lambda_yank",
				token: "lambda-token",
				baseUrl: "https://lambda.example",
			});
		}),
	);

	it.effect("resolves the integration a subscription execution originated from", () =>
		Effect.gen(function* () {
			const requested: GetForUserInput[] = [];
			const result = yield* runGetCurrentIntegration(
				subscriptionSubject({
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
				subscriptionSubject({ kind: "api" }),
			] satisfies SandboxExecutionSubject[],
			(subject) =>
				Effect.gen(function* () {
					const result = yield* runGetCurrentIntegration(subject, () =>
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
			output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 10 } },
		},
	},
} as const satisfies RyotQLDocument;

const ryotqlResponse = {
	data: {
		entities: {
			items: [],
			type: "rows" as const,
			pageInfo: { limit: 10, hasMore: false, nextCursor: null },
		},
	},
};

const systemPluginScope = {
	eventSchemas: [],
	pluginSlug: "example",
	entitySchemaSlugs: ["example"],
	relationshipSchemaSlugs: ["example-monitoring"],
};

const systemPluginRevision = {
	ownerId: null,
	id: "plugin-id",
	slug: "example",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: {
		eventSchemas: systemPluginScope.eventSchemas,
		entitySchemaSlugs: systemPluginScope.entitySchemaSlugs,
		relationshipSchemaSlugs: systemPluginScope.relationshipSchemaSlugs,
	},
};

const runExecuteRyotql = (input: SandboxRunInput, document: RyotQLDocument = ryotqlDocument) => {
	const userCalls: unknown[] = [];
	const pluginCalls: unknown[] = [];
	return makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) => Effect.result(functions.executeRyotql(input, document))),
		Effect.map((result) => ({ result, pluginCalls, userCalls })),
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(IntegrationsRepository)({}),
				Layer.mock(RelationshipsRepository)({}),
				Layer.succeed(DefinitionRegistry, makeDefinitionRegistry()),
				Layer.mock(PluginRuntimeResolver)({}),
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
	it.effect("keeps pinned schema scope after the active manifest changes", () =>
		Effect.gen(function* () {
			const activeManifest = { schemaScope: systemPluginRevision.schemaScope };
			const pinnedRevision = { ...systemPluginRevision, schemaScope: activeManifest.schemaScope };
			activeManifest.schemaScope = {
				eventSchemas: [],
				entitySchemaSlugs: ["replacement"],
				relationshipSchemaSlugs: [],
			};
			const execution = yield* runExecuteRyotql({
				...runInput({ type: "system" }),
				principal: {
					...runInput({ type: "system" }).principal,
					metadata: { kind: "script" },
					pluginRevision: pinnedRevision,
				},
			});

			expect(Result.getOrThrow(execution.result)).toEqual(ryotqlResponse);
			expect(execution.pluginCalls).toEqual([
				{
					document: ryotqlDocument,
					scope: {
						eventSchemas: [],
						pluginSlug: "example",
						entitySchemaSlugs: ["example"],
						relationshipSchemaSlugs: ["example-monitoring"],
					},
				},
			]);
			expect(execution.userCalls).toEqual([]);
		}),
	);

	it.effect("keeps delegated execution in user scope", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql(runInput(subscriptionSubject({ kind: "api" })));

			expect(Result.getOrThrow(execution.result)).toEqual(ryotqlResponse);
			expect(execution.pluginCalls).toEqual([]);
			expect(execution.userCalls).toEqual([
				{ userId: "user-1", language: null, document: ryotqlDocument },
			]);
		}),
	);

	it.effect("rejects unpinned system execution", () =>
		Effect.gen(function* () {
			const execution = yield* runExecuteRyotql({
				...runInput({ type: "system" }),
				principal: { ...runInput({ type: "system" }).principal, metadata: { kind: "script" } },
			});

			expect(Result.getFailure(execution.result)).toEqual(
				Option.some({
					message: "executeRyotql system access requires a pinned system plugin script",
				}),
			);
			expect(execution.pluginCalls).toEqual([]);
		}),
	);

	it.effect("rejects caller-supplied execution scope in the document", () =>
		Effect.gen(function* () {
			const callerSuppliedDocument = { ...ryotqlDocument, scope: "plugin" };
			const execution = yield* runExecuteRyotql(
				runInput({ type: "user", userId: UserId.make("user-1") }),
				callerSuppliedDocument,
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
			principal: {
				...runInput({ type: "system" }).principal,
				pluginRevision: systemPluginRevision,
				metadata: { kind: "script", capabilities: ["executeRyotql"] },
			},
		});

		expect(selected).toEqual({ executeRyotql });
	});
});

const runChangeUserRelationships = (
	subject: SandboxExecutionSubject,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
	repository: Layer.Layer<RelationshipsRepository>,
	getEntityScopeForUser: (input: {
		userId: UserId;
		entityId: EntityId;
	}) => Effect.Effect<{
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
			Effect.result(functions.changeUserRelationships(runInput(subject), batches)),
		),
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(RyotQLService)({}),
				Layer.mock(PluginRuntimeResolver)({
					getEffectiveDefinitions: () => Effect.succeed(makeDefinitionRegistry().getSnapshot()),
				}),
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

	it.effect("derives the relationship owner from direct user subject", () => {
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
					relationshipSchemaPluginId: null,
					relationshipSchemaSlug: "member-of",
				},
			]);
		});
	});

	it.effect("derives the relationship owner from subscription subject", () => {
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
				subscriptionSubject({ kind: "api" }),
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
					relationshipSchemaPluginId: null,
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
					relationshipSchemaPluginId: null,
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
				subscriptionSubject({ kind: "api" }),
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
				Option.some({
					message: "entity-not-found",
					data: { code: "entity-not-found", entityIds: ["entity-1", "collection-1"] },
				}),
			);
			expect(writes).toBe(0);
		});
	});

	it.effect("rejects system subject and total change overflow before writing", () => {
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
	schemaPluginId?: string;
	subject: SandboxExecutionSubject;
	caller: { pluginSlug: string } | null;
	allowedHostFunctions?: readonly string[];
	pinnedEntitySchemaSlugs?: readonly string[];
	ensure?: (
		userId: UserId,
		items: ReadonlyArray<{ name: string; properties: unknown; entitySchemaSlug: EntitySchemaSlug }>,
	) => Effect.Effect<Array<{ entityId: EntityId; wasInserted: boolean }>>;
}) => {
	const definitions = makeDefinitionRegistry({
		savedViews: [],
		signalSchemas: [],
		relationshipSchemas: [],
		entitySchemas: [
			{
				icon: "box",
				eventSchemas: [],
				slug: "workspace",
				name: "Workspace",
				pluginSlug: "example",
				mergeIdentityProperties: [],
				propertiesSchema: { fields: {} },
				pluginId: options.schemaPluginId ?? systemPluginRevision.id,
			},
		],
	});
	return makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.ensureUserEntities(
					runInput(options.subject, options.allowedHostFunctions, {
						pluginRevision: options.caller
							? {
									...systemPluginRevision,
									slug: options.caller.pluginSlug,
									userBootstrapScriptSlugs: ["script"],
									schemaScope: {
										...systemPluginRevision.schemaScope,
										entitySchemaSlugs: options.pinnedEntitySchemaSlugs ?? ["workspace"],
									},
								}
							: null,
					}),
					[{ name: "Workspace", properties: {}, entitySchemaSlug: "workspace" }],
				),
			),
		),
		Effect.provide(
			Layer.mergeAll(
				databaseLayer,
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
					getEffectiveDefinitions: () => Effect.succeed(definitions.getSnapshot()),
				}),
				Layer.succeed(DefinitionRegistry, definitions),
			),
		),
	);
};

describe("ensureUserEntities", () => {
	it.effect("binds the direct user and preserves first-create/idempotent results", () => {
		const calls: Array<unknown> = [];
		let attempt = 0;
		return Effect.gen(function* () {
			const run = () =>
				runEnsureUserEntities({
					caller: { pluginSlug: "example" },
					subject: { type: "user", userId: UserId.make("trusted-user") },
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
			const trusted = { pluginSlug: "example" };
			const delegated = yield* runEnsureUserEntities({
				caller: trusted,
				subject: subscriptionSubject({ kind: "api" }),
			});
			const system = yield* runEnsureUserEntities({ caller: trusted, subject: { type: "system" } });
			const untrusted = yield* runEnsureUserEntities({
				caller: null,
				subject: { type: "user", userId: UserId.make("user-1") },
			});
			const foreign = yield* runEnsureUserEntities({
				caller: trusted,
				schemaPluginId: "sample-plugin-id",
				subject: { type: "user", userId: UserId.make("user-1") },
			});

			expect(Result.getFailure(delegated)).toEqual(
				Option.some({ message: "ensureUserEntities is available only to user executions" }),
			);
			expect(Result.getFailure(system)).toEqual(
				Option.some({ message: "ensureUserEntities is not available for system executions" }),
			);
			expect(Result.getFailure(untrusted)).toEqual(
				Option.some({
					message: "ensureUserEntities is available only to pinned system user bootstrap scripts",
				}),
			);
			expect(Result.getFailure(foreign)).toEqual(
				Option.some({
					message: "ensureUserEntities cannot write foreign entity schema: workspace",
				}),
			);
		}),
	);

	it.effect("rejects a current same-plugin schema outside the pinned bootstrap scope", () =>
		Effect.gen(function* () {
			const result = yield* runEnsureUserEntities({
				pinnedEntitySchemaSlugs: [],
				caller: { pluginSlug: "example" },
				subject: { type: "user", userId: UserId.make("user-1") },
			});

			expect(Result.getFailure(result)).toEqual(
				Option.some({
					message: "ensureUserEntities cannot write foreign entity schema: workspace",
				}),
			);
		}),
	);

	it.effect("refuses a private script that declares the capability", () =>
		Effect.gen(function* () {
			const declared = yield* runEnsureUserEntities({
				caller: null,
				allowedHostFunctions: ["ensureUserEntities"],
				subject: { type: "user", userId: UserId.make("owner-1") },
			});

			expect(Result.getFailure(declared)).toEqual(
				Option.some({
					message: "ensureUserEntities is available only to pinned system user bootstrap scripts",
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
					failure: { index: 0, reason: { code: "policy-failed" } },
				}),
			);

			expect(Result.getFailure(result)).toEqual(
				Option.some("Event creation failed: policy-failed"),
			);
		}),
	);
});
