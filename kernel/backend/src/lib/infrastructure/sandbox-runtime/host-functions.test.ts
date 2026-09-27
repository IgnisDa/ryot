import { describe, expect, it, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	RelationshipId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import type { ChangeUserRelationshipBatch } from "@ryot-app/sandbox-sdk/core";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Ref, Result } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService } from "#lib/infrastructure/redis";
import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { selectSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { AuthRepository } from "#modules/auth/repository";
import { withLifecycleBatchPlanning } from "#modules/automations/lifecycle.test-support";
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	buildDefinitionSnapshot,
	type DefinitionSource,
} from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipMutationPipeline } from "#modules/relationships/mutation-pipeline";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";

import { makeAdditionalSandboxApiFunctions, toSandboxCreateEventsResult } from "./host-functions";

const seededDatabase = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{
					id: "user-1",
					name: "User",
					email: "host-user@example.test",
					accountGeneration: "test-account-generation",
				},
				{
					name: "Trusted",
					id: "trusted-user",
					email: "trusted-host@example.test",
					accountGeneration: "test-account-generation",
				},
				{
					id: "owner-1",
					name: "Owner",
					email: "owner-host@example.test",
					accountGeneration: "test-account-generation",
				},
			]),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("sandbox_host_functions")));

const hostDatabaseLayer = Layer.mergeAll(
	seededDatabase,
	Layer.mock(LifecyclePlanner)(
		withLifecycleBatchPlanning({
			plan: ({ trigger }) => Effect.succeed({ trigger, runs: [], policies: [], wasCreated: true }),
		}),
	),
	Layer.mock(LifecycleExecution)({
		after: () => Effect.succeed([]),
		dispatch: () => Effect.succeed([]),
		skipQueuedPolicies: () => Effect.void,
	}),
);

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
	pluginSlug: "fixture",
	provider: "lambda_yank",
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
	capabilities: readonly string[] = SANDBOX_HOST_CAPABILITIES,
	principalFacts: Partial<SandboxExecutionPrincipal> = {},
): SandboxRunInput => ({
	compiledCode: "",
	compiledFormat: 1,
	hostCallDiscriminator: 0,
	executionId: "execution-1",
	workflowExecutionId: "workflow-1",
	startedAt: "2026-01-01T00:00:00.000Z",
	principal: {
		subject,
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "script",
		scriptId: SandboxScriptId.make("script-1"),
		metadata: { capabilities: [...capabilities] },
		...principalFacts,
	},
	context:
		subject.type === "automation-run"
			? {
					automation: {
						hookSlug: "script",
						runId: subject.runId,
						causation: subject.causation,
						triggerId: subject.triggerId,
						occurredAt: "2026-01-01T00:00:00.000Z",
						executionUserId: subject.executionUserId,
						payload: {
							properties: {},
							operation: "emit",
							resource: "signal",
							category: "signal",
							signalSchemaPluginId: null,
							signalSchemaSlug: "fixture.signal",
							actorUserId: subject.executionUserId,
						},
					},
				}
			: {},
});

const automationSubject = (
	origin:
		| { readonly kind: "api" }
		| { readonly kind: "integration"; readonly integrationId: IntegrationId },
) =>
	({
		stage: "after",
		pluginId: null,
		type: "automation-run",
		pluginRevisionId: null,
		pluginConfigRevisionId: null,
		runId: AutomationRunId.make("run-1"),
		executionUserId: UserId.make("user-1"),
		triggerId: AutomationTriggerId.make("trigger-1"),
		accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		causation: {
			depth: 0,
			parentRunId: null,
			source: origin.kind,
			parentTriggerId: null,
			executionId: AutomationExecutionId.make("root-execution"),
			rootExecutionId: AutomationExecutionId.make("root-execution"),
			initiator:
				origin.kind === "integration"
					? { kind: "integration", id: origin.integrationId }
					: { kind: "user", id: UserId.make("user-1") },
			...(origin.kind === "integration" ? { integrationId: origin.integrationId } : {}),
		},
	}) satisfies SandboxExecutionSubject;

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
	slug: "example",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-id"),
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: {
		eventSchemas: systemPluginScope.eventSchemas,
		entitySchemaSlugs: systemPluginScope.entitySchemaSlugs,
		relationshipSchemaSlugs: systemPluginScope.relationshipSchemaSlugs,
	},
};

type EntityScope = {
	entityId: EntityId;
	isBuiltin: boolean;
	entityName: string;
	entityUserId: UserId | null;
	entitySchemaPluginId: string | null;
	entitySchemaSlug: EntitySchemaSlug;
};

const builtinEntityScope = ({ entityId }: { userId: UserId; entityId: EntityId }) =>
	Effect.succeed<EntityScope | null>({
		entityId,
		isBuiltin: true,
		entityUserId: null,
		entityName: "Entity",
		entitySchemaPluginId: null,
		entitySchemaSlug: EntitySchemaSlug.make(entityId === "collection-1" ? "collection" : "entity"),
	});

class HostFunctionCalls extends Context.Service<
	HostFunctionCalls,
	{
		readonly ensuredEntities: Effect.Effect<ReadonlyArray<unknown>>;
		readonly ryotqlUserCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly ryotqlPluginCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly pluginConfigLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly createdRelationships: Effect.Effect<ReadonlyArray<unknown>>;
		readonly deletedRelationships: Effect.Effect<ReadonlyArray<unknown>>;
		readonly integrationLookups: Effect.Effect<ReadonlyArray<GetForUserInput>>;
		readonly oauthTokenRequests: Effect.Effect<ReadonlyArray<unknown>>;
		readonly useDefinitions: (source: DefinitionSource) => Effect.Effect<void>;
	}
>()("test/HostFunctionCalls") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const hostFunctionsLayer = (
	options: {
		readonly definitions?: DefinitionSource;
		readonly forbidRelationshipWrites?: boolean;
		readonly entityScope?: typeof builtinEntityScope;
		readonly integration?: (input: GetForUserInput) => Effect.Effect<IntegrationRecord | null>;
		readonly pluginConfig?: PluginRuntimeResolver["Service"]["resolvePluginConfigContext"];
		readonly oauthAccessToken?: OAuthConnectionsService["Service"]["accessTokenForIntegrationRun"];
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const ensuredEntities = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const ryotqlUserCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const ryotqlPluginCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const pluginConfigLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const createdRelationships = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const deletedRelationships = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const integrationLookups = yield* Ref.make<ReadonlyArray<GetForUserInput>>([]);
			const oauthTokenRequests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const snapshot = yield* Ref.make(
				buildDefinitionSnapshot(options.definitions ?? kernelDefinitionSource()),
			);
			const dependencies = Layer.mergeAll(
				hostDatabaseLayer,
				AuthRepository.layer.pipe(Layer.provide(hostDatabaseLayer)),
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({}),
				Layer.succeed(HostFunctionCalls, {
					ensuredEntities: Ref.get(ensuredEntities),
					ryotqlUserCalls: Ref.get(ryotqlUserCalls),
					ryotqlPluginCalls: Ref.get(ryotqlPluginCalls),
					integrationLookups: Ref.get(integrationLookups),
					oauthTokenRequests: Ref.get(oauthTokenRequests),
					pluginConfigLookups: Ref.get(pluginConfigLookups),
					createdRelationships: Ref.get(createdRelationships),
					deletedRelationships: Ref.get(deletedRelationships),
					useDefinitions: (source) => Ref.set(snapshot, buildDefinitionSnapshot(source)),
				}),
				Layer.mock(DefinitionRepository)({
					findUserEntitySchemas: () => Effect.map(Ref.get(snapshot), (all) => all.entitySchemas),
					findUserRelationshipSchemas: () =>
						Effect.map(Ref.get(snapshot), (all) => all.relationshipSchemas),
					findGlobalRelationshipSchema: (slug) =>
						Effect.map(Ref.get(snapshot), (all) => all.relationshipSchemas[slug] ?? null),
				}),
				Layer.mock(IntegrationsRepository)({
					getForUser: (input) =>
						append(integrationLookups, input).pipe(
							Effect.andThen(
								options.integration ? options.integration(input) : Effect.die("unused"),
							),
						),
				}),
				Layer.mock(OAuthConnectionsService)({
					accessTokenForIntegrationRun: (input) =>
						append(oauthTokenRequests, input).pipe(
							Effect.andThen(
								options.oauthAccessToken
									? options.oauthAccessToken(input)
									: Effect.die("unused OAuth access token"),
							),
						),
				}),
				Layer.mock(PluginRuntimeResolver)({
					lockCatalog: () => Effect.void,
					resolvePluginConfigContext: (input) =>
						append(pluginConfigLookups, input).pipe(
							Effect.andThen(
								options.pluginConfig
									? options.pluginConfig(input)
									: Effect.die("unused plugin config"),
							),
						),
				}),
				Layer.mock(RyotQLService)({
					executeForPlugin: (scope, doc) =>
						append(ryotqlPluginCalls, { scope, document: doc }).pipe(Effect.as(ryotqlResponse)),
					executeForUser: (userId, language, audience, doc) =>
						append(ryotqlUserCalls, { userId, language, audience, document: doc }).pipe(
							Effect.as(ryotqlResponse),
						),
				}),
				Layer.mock(EntitiesRepository)({
					lockEntityReferencesByIds: () => Effect.void,
					getEntityScopeForUser: options.entityScope ?? builtinEntityScope,
				}),
				Layer.mock(EntitiesService)({
					ensureUserEntities: (userId, items, lifecycle) =>
						Ref.modify(ensuredEntities, (all) => [
							all.length === 0,
							[...all, { items, userId, lifecycle }],
						]).pipe(
							Effect.map((wasInserted) => [
								{ wasInserted, warnings: [], entityId: EntityId.make("workspace-id") },
							]),
						),
				}),
				Layer.mock(RelationshipsRepository)({
					findRelationship: () => Effect.succeed(null),
					lockRelationshipMutations: () => Effect.void,
					createRelationship: (input) =>
						append(createdRelationships, input).pipe(
							Effect.andThen(
								options.forbidRelationshipWrites
									? Effect.die("must not write")
									: Effect.succeed({
											...input,
											wasInserted: true,
											createdAt: "2026-07-28T00:00:00.000Z",
											updatedAt: "2026-07-28T00:00:00.000Z",
											id: RelationshipId.make("relationship-1"),
										}),
							),
						),
					...(options.forbidRelationshipWrites
						? {}
						: {
								deleteRelationship: (input: unknown) =>
									append(deletedRelationships, input).pipe(Effect.as(null)),
							}),
				}),
			);
			return RelationshipMutationPipeline.layer.pipe(Layer.provideMerge(dependencies));
		}),
	);

const runGetCurrentIntegration = (subject: SandboxExecutionSubject) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.getCurrentIntegration(runInput(subject))),
		),
	);

const executeRyotql = () => Effect.void;

describe("getUserPreferences", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("reads authoritative preferences and preserves missing-user failures", () =>
			Effect.gen(function* () {
				const auth = yield* AuthRepository;
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				yield* auth.patchUserPreferences(userId, { disableIntegrations: true });
				expect(
					yield* functions.getUserPreferences(
						runInput({
							userId,
							type: "user",
							accountGeneration: { userId, token: "test-account-generation" },
						}),
					),
				).toEqual({ disableIntegrations: true });
				expect(
					yield* Effect.flip(
						functions.getUserPreferences(
							runInput({
								type: "user",
								userId: UserId.make("missing"),
								accountGeneration: {
									userId: UserId.make("missing"),
									token: "test-account-generation",
								},
							}),
						),
					),
				).toEqual({ message: "User not found" });
			}),
		);

		test.effect("reports malformed preferences through the host boundary", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const exit = yield* Effect.exit(
					session.transaction(
						Effect.gen(function* () {
							yield* session.run((db) =>
								db.execute(sql`alter table "user" drop constraint user_preferences_check`),
							);
							yield* session.run((db) =>
								db.execute(
									sql`update "user" set preferences = '{"disableIntegrations":"yes"}'::jsonb where id = 'user-1'`,
								),
							);
							expect(
								yield* Effect.flip(
									functions.getUserPreferences(
										runInput({
											type: "user",
											userId: UserId.make("user-1"),
											accountGeneration: {
												userId: UserId.make("user-1"),
												token: "test-account-generation",
											},
										}),
									),
								).pipe(Effect.orDie),
							).toEqual({ message: "Invalid stored user preferences" });
							return yield* new DbError({ message: "roll back malformed preferences" });
						}),
					),
				);
				assertExitFails(exit, new DbError({ message: "roll back malformed preferences" }));
			}),
		);

		test.effect("captures preference reads from a replacement constructor dependency", () =>
			Effect.gen(function* () {
				const auth = yield* AuthRepository;
				const functions = yield* makeAdditionalSandboxApiFunctions.pipe(
					Effect.provideService(
						AuthRepository,
						AuthRepository.of({
							...auth,
							getUserPreferences: () =>
								Effect.succeed({ ...defaultUserPreferences, disableIntegrations: true }),
						}),
					),
				);
				expect(
					yield* functions.getUserPreferences(
						runInput({
							type: "user",
							userId: UserId.make("not-in-database"),
							accountGeneration: {
								token: "test-account-generation",
								userId: UserId.make("not-in-database"),
							},
						}),
					),
				).toEqual({ disableIntegrations: true });
			}),
		);
	});
});

const runGetOAuthAccessToken = (
	subject: SandboxExecutionSubject,
	principalFacts: Partial<SandboxExecutionPrincipal> = { pluginRevision: systemPluginRevision },
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.getOAuthAccessToken(
					runInput(subject, SANDBOX_HOST_CAPABILITIES, {
						...principalFacts,
						metadata: {
							oauthConnectionFields: ["account"],
							capabilities: SANDBOX_HOST_CAPABILITIES,
							...principalFacts.metadata,
						},
					}),
					{ field: "account" },
				),
			),
		),
	);

describe("getOAuthAccessToken", () => {
	const integrationRunSubject = {
		type: "user",
		userId: UserId.make("user-1"),
		integrationId: IntegrationId.make("int-trusted"),
		integrationRunId: ImportRunId.make("run-trusted"),
		accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
	} satisfies SandboxExecutionSubject;

	layer(
		hostFunctionsLayer({
			oauthAccessToken: () =>
				Effect.succeed({ accessToken: "access-1", expiresAt: "2026-01-01T01:00:00.000Z" }),
		}),
	)((test) => {
		test.effect("forwards the trusted integration run scope to the connection owner", () =>
			Effect.gen(function* () {
				const result = yield* runGetOAuthAccessToken(integrationRunSubject);

				expect(Result.getOrThrow(result)).toEqual({
					accessToken: "access-1",
					expiresAt: "2026-01-01T01:00:00.000Z",
				});
				expect(yield* (yield* HostFunctionCalls).oauthTokenRequests).toEqual([
					{
						field: "account",
						userId: "user-1",
						pluginId: "plugin-id",
						integrationId: "int-trusted",
						integrationRunId: "run-trusted",
					},
				]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects executions that are not a running integration's plugin run", () =>
			Effect.gen(function* () {
				const cases = [
					{
						message: "getOAuthAccessToken is available only to integration run executions",
						subject: {
							type: "user",
							userId: UserId.make("user-1"),
							integrationId: IntegrationId.make("int-trusted"),
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						} satisfies SandboxExecutionSubject,
					},
					{
						subject: integrationRunSubject,
						principalFacts: { pluginRevision: null },
						message: "getOAuthAccessToken is available only to integration run executions",
					},
					{
						message: "getOAuthAccessToken is available only to user executions",
						subject: automationSubject({
							kind: "integration",
							integrationId: IntegrationId.make("int-trusted"),
						}),
					},
				];
				for (const { message, subject, principalFacts } of cases) {
					const result = yield* runGetOAuthAccessToken(
						subject,
						principalFacts ?? { pluginRevision: systemPluginRevision },
					);
					expect(Result.getFailure(result)).toEqual(Option.some({ message }));
				}
				expect(yield* (yield* HostFunctionCalls).oauthTokenRequests).toEqual([]);
			}),
		);
	});
});

describe("getCurrentIntegration", () => {
	layer(hostFunctionsLayer({ integration: (input) => Effect.succeed(ownedIntegration(input)) }))(
		(test) => {
			test.effect("resolves the integration the operation execution was dispatched for", () =>
				Effect.gen(function* () {
					const result = yield* runGetCurrentIntegration({
						type: "user",
						userId: UserId.make("user-1"),
						integrationId: IntegrationId.make("int-trusted"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					});

					expect(yield* (yield* HostFunctionCalls).integrationLookups).toEqual([
						{ userId: "user-1", integrationId: "int-trusted" },
					]);
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
		},
	);

	layer(hostFunctionsLayer({ integration: (input) => Effect.succeed(ownedIntegration(input)) }))(
		(test) => {
			test.effect("resolves the integration a subscription execution originated from", () =>
				Effect.gen(function* () {
					const result = yield* runGetCurrentIntegration(
						automationSubject({
							kind: "integration",
							integrationId: IntegrationId.make("int-origin"),
						}),
					);

					expect(yield* (yield* HostFunctionCalls).integrationLookups).toEqual([
						{ userId: "user-1", integrationId: "int-origin" },
					]);
					expect(Result.getOrThrow(result).id).toBe("int-origin");
				}),
			);
		},
	);

	layer(hostFunctionsLayer({ integration: () => Effect.die("must not reach the repository") }))(
		(test) => {
			test.effect("fails when the execution has no integration in scope", () =>
				Effect.forEach(
					[
						{
							type: "user",
							userId: UserId.make("user-1"),
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
						automationSubject({ kind: "api" }),
					] satisfies SandboxExecutionSubject[],
					(subject) =>
						Effect.gen(function* () {
							const result = yield* runGetCurrentIntegration(subject);

							expect(Result.getFailure(result)).toEqual(
								Option.some({
									message:
										"getCurrentIntegration is available only to executions scoped to an integration",
								}),
							);
						}),
				),
			);
		},
	);

	layer(hostFunctionsLayer({ integration: () => Effect.succeed(null) }))((test) => {
		test.effect("keeps the executing user's ownership scope", () =>
			Effect.gen(function* () {
				const result = yield* runGetCurrentIntegration({
					type: "user",
					userId: UserId.make("user-1"),
					integrationId: IntegrationId.make("int-of-another-user"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});

				expect(Result.getFailure(result)).toEqual(
					Option.some({ message: "Integration not found" }),
				);
			}),
		);
	});
});

const pluginConfigSchema = {
	unknownKeys: "strict",
	fields: {
		apiToken: { type: "string", label: "API token", description: "Token used by the plugin" },
	},
} as const;

const runGetPluginConfig = (principalFacts: Partial<SandboxExecutionPrincipal>) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.getPluginConfig(
					runInput({ type: "system" }, ["getPluginConfig"], {
						...principalFacts,
						metadata: { capabilities: ["getPluginConfig"], requiredPluginConfigKeys: ["apiToken"] },
					}),
					{ required: ["apiToken"] },
				),
			),
		),
	);

describe("getPluginConfig", () => {
	layer(hostFunctionsLayer({ pluginConfig: () => Effect.succeed({ apiToken: "pinned-value" }) }))(
		(test) => {
			test.effect("resolves the exact pinned configuration revision", () =>
				Effect.gen(function* () {
					const result = yield* runGetPluginConfig({
						pluginRevision: { ...systemPluginRevision, configSchema: pluginConfigSchema },
					});

					expect(Result.getOrThrow(result)).toEqual({ apiToken: "pinned-value" });
					expect(yield* (yield* HostFunctionCalls).pluginConfigLookups).toEqual([
						{ id: "config-1", ownerUserId: null, pluginRevisionId: "revision-1" },
					]);
				}),
			);
		},
	);

	layer(hostFunctionsLayer({ pluginConfig: () => Effect.die("must not resolve unpinned config") }))(
		(test) => {
			test.effect("rejects config access before resolving without a trusted pin", () =>
				Effect.gen(function* () {
					const result = yield* runGetPluginConfig({});

					expect(Result.getFailure(result)).toEqual(
						Option.some({ message: "Plugin config is available only to active plugin scripts" }),
					);
				}),
			);
		},
	);

	layer(
		hostFunctionsLayer({
			pluginConfig: () =>
				Effect.fail(new DbError({ message: "Invalid pinned plugin configuration ownership" })),
		}),
	)((test) => {
		test.effect("preserves the structured failure for an unavailable pinned configuration", () =>
			Effect.gen(function* () {
				const result = yield* runGetPluginConfig({
					pluginRevision: { ...systemPluginRevision, configSchema: pluginConfigSchema },
				});

				expect(Result.getFailure(result)).toMatchObject(
					Option.some({
						_tag: "DbError",
						message: "Invalid pinned plugin configuration ownership",
					}),
				);
			}),
		);
	});
});

const runExecuteRyotql = (input: SandboxRunInput, document: RyotQLDocument = ryotqlDocument) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) => Effect.result(functions.executeRyotql(input, document))),
	);

describe("executeRyotql", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("keeps pinned schema scope after the active manifest changes", () =>
			Effect.gen(function* () {
				const activeManifest = { schemaScope: systemPluginRevision.schemaScope };
				const pinnedRevision = { ...systemPluginRevision, schemaScope: activeManifest.schemaScope };
				activeManifest.schemaScope = {
					eventSchemas: [],
					relationshipSchemaSlugs: [],
					entitySchemaSlugs: ["replacement"],
				};
				const result = yield* runExecuteRyotql({
					...runInput({ type: "system" }),
					principal: {
						...runInput({ type: "system" }).principal,
						pluginRevision: pinnedRevision,
						metadata: { kind: "script", capabilities: ["executeRyotql"] },
					},
				});

				const calls = yield* HostFunctionCalls;
				expect(Result.getOrThrow(result)).toEqual(ryotqlResponse);
				expect(yield* calls.ryotqlPluginCalls).toEqual([
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
				expect(yield* calls.ryotqlUserCalls).toEqual([]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("keeps delegated execution in the user scope with the plugin audience", () =>
			Effect.gen(function* () {
				const result = yield* runExecuteRyotql(runInput(automationSubject({ kind: "api" })));

				const calls = yield* HostFunctionCalls;
				expect(Result.getOrThrow(result)).toEqual(ryotqlResponse);
				expect(yield* calls.ryotqlPluginCalls).toEqual([]);
				expect(yield* calls.ryotqlUserCalls).toEqual([
					{ language: null, userId: "user-1", audience: "plugin", document: ryotqlDocument },
				]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects unpinned system execution", () =>
			Effect.gen(function* () {
				const result = yield* runExecuteRyotql({
					...runInput({ type: "system" }),
					principal: {
						...runInput({ type: "system" }).principal,
						metadata: { kind: "script", capabilities: ["executeRyotql"] },
					},
				});

				expect(Result.getFailure(result)).toEqual(
					Option.some({
						message: "executeRyotql system access requires a pinned system plugin script",
					}),
				);
				expect(yield* (yield* HostFunctionCalls).ryotqlPluginCalls).toEqual([]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects caller-supplied execution scope in the document", () =>
			Effect.gen(function* () {
				const callerSuppliedDocument = { ...ryotqlDocument, scope: "plugin" };
				const result = yield* runExecuteRyotql(
					runInput({
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					}),
					callerSuppliedDocument,
				);

				expect(Option.getOrThrow(Result.getFailure(result))).toMatchObject({
					message: expect.stringContaining("scope"),
				});
				expect(yield* (yield* HostFunctionCalls).ryotqlUserCalls).toEqual([]);
			}),
		);
	});

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
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.changeUserRelationships(runInput(subject), batches)),
		),
	);

describe("changeUserRelationships", () => {
	const identity = {
		sourceEntityId: "entity-1",
		targetEntityId: "collection-1",
		relationshipSchemaSlug: "member-of",
	};
	const batch = { deletes: [], creates: [{ ...identity, properties: {} }] };

	layer(hostFunctionsLayer())((test) => {
		test.effect("derives the relationship owner from direct user subject", () =>
			Effect.gen(function* () {
				const result = yield* runChangeUserRelationships(
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
					[batch],
				);

				expect(Result.getOrThrow(result)).toEqual([{ created: 1, deleted: 0 }]);
				expect(yield* (yield* HostFunctionCalls).createdRelationships).toEqual([
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
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("derives the relationship owner from subscription subject", () =>
			Effect.gen(function* () {
				const result = yield* runChangeUserRelationships(automationSubject({ kind: "api" }), [
					batch,
				]);

				expect(Result.getOrThrow(result)).toEqual([{ created: 1, deleted: 0 }]);
				expect(yield* (yield* HostFunctionCalls).createdRelationships).toEqual([
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
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("does not write an absent relationship delete", () =>
			Effect.gen(function* () {
				const result = yield* runChangeUserRelationships(
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
					[{ creates: [], deletes: [identity] }],
				);

				expect(Result.getOrThrow(result)).toEqual([{ created: 0, deleted: 0 }]);
				expect(yield* (yield* HostFunctionCalls).deletedRelationships).toEqual([]);
			}),
		);
	});

	layer(
		hostFunctionsLayer({
			forbidRelationshipWrites: true,
			entityScope: ({ userId, entityId }) =>
				entityId === "collection-1" && userId === "user-1"
					? Effect.succeed(null)
					: Effect.succeed({
							entityId,
							isBuiltin: true,
							entityUserId: null,
							entityName: "Entity",
							entitySchemaPluginId: null,
							entitySchemaSlug: EntitySchemaSlug.make("entity"),
						}),
		}),
	)((test) => {
		test.effect("rejects a subscription relationship with an endpoint invisible to its user", () =>
			Effect.gen(function* () {
				const result = yield* runChangeUserRelationships(automationSubject({ kind: "api" }), [
					batch,
				]);

				expect(Result.getFailure(result)).toMatchObject(
					Option.some({
						message: "entity-not-found",
						data: { code: "entity-not-found", entityIds: ["entity-1", "collection-1"] },
					}),
				);
				expect(yield* (yield* HostFunctionCalls).createdRelationships).toHaveLength(0);
			}),
		);
	});

	layer(hostFunctionsLayer({ forbidRelationshipWrites: true }))((test) => {
		test.effect("rejects system subject and total change overflow before writing", () =>
			Effect.gen(function* () {
				const overflow = Array.from({ length: 501 }, () => identity);
				const system = yield* runChangeUserRelationships({ type: "system" }, [batch]);
				const tooMany = yield* runChangeUserRelationships(
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
					[{ creates: [], deletes: overflow }],
				);

				expect(Result.getFailure(system)).toEqual(
					Option.some({
						message: "changeUserRelationships is not available for system executions",
					}),
				);
				expect(Result.getFailure(tooMany)).toEqual(
					Option.some({ message: "changeUserRelationships exceeds 500 changes" }),
				);
				expect(yield* (yield* HostFunctionCalls).createdRelationships).toHaveLength(0);
			}),
		);
	});
});

const workspaceDefinitions = (schemaPluginId: string = systemPluginRevision.id) => ({
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
			pluginId: schemaPluginId,
			mergeIdentityProperties: [],
			propertiesSchema: { fields: {} },
		},
	],
});

const runEnsureUserEntities = (options: {
	subject: SandboxExecutionSubject;
	caller: { pluginSlug: string } | null;
	allowedHostFunctions?: readonly string[];
	pinnedEntitySchemaSlugs?: readonly string[];
}) =>
	makeAdditionalSandboxApiFunctions.pipe(
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
					[{ properties: {}, name: "Workspace", entitySchemaSlug: "workspace" }],
				),
			),
		),
	);

describe("ensureUserEntities", () => {
	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("binds the direct user and preserves first-create/idempotent results", () =>
			Effect.gen(function* () {
				const run = runEnsureUserEntities({
					caller: { pluginSlug: "example" },
					subject: {
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: {
							token: "test-account-generation",
							userId: UserId.make("trusted-user"),
						},
					},
				});
				expect(Result.getOrThrow(yield* run)).toEqual([
					{ wasInserted: true, entityId: "workspace-id" },
				]);
				expect(Result.getOrThrow(yield* run)).toEqual([
					{ wasInserted: false, entityId: "workspace-id" },
				]);
				expect(yield* (yield* HostFunctionCalls).ensuredEntities).toMatchObject([
					{
						userId: "trusted-user",
						items: [{ properties: {}, name: "Workspace", entitySchemaSlug: "workspace" }],
					},
					{
						userId: "trusted-user",
						items: [{ properties: {}, name: "Workspace", entitySchemaSlug: "workspace" }],
					},
				]);
			}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("rejects delegated, system, untrusted, and foreign-schema executions", () =>
			Effect.gen(function* () {
				const trusted = { pluginSlug: "example" };
				const delegated = yield* runEnsureUserEntities({
					caller: trusted,
					subject: automationSubject({ kind: "api" }),
				});
				const system = yield* runEnsureUserEntities({
					caller: trusted,
					subject: { type: "system" },
				});
				const untrusted = yield* runEnsureUserEntities({
					caller: null,
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
				});
				yield* (yield* HostFunctionCalls).useDefinitions(workspaceDefinitions("sample-plugin-id"));
				const foreign = yield* runEnsureUserEntities({
					caller: trusted,
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
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
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("rejects a current same-plugin schema outside the pinned bootstrap scope", () =>
			Effect.gen(function* () {
				const result = yield* runEnsureUserEntities({
					pinnedEntitySchemaSlugs: [],
					caller: { pluginSlug: "example" },
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
				});

				expect(Result.getFailure(result)).toEqual(
					Option.some({
						message: "ensureUserEntities cannot write foreign entity schema: workspace",
					}),
				);
			}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("refuses a private script that declares the capability", () =>
			Effect.gen(function* () {
				const declared = yield* runEnsureUserEntities({
					caller: null,
					allowedHostFunctions: ["ensureUserEntities"],
					subject: {
						type: "user",
						userId: UserId.make("owner-1"),
						accountGeneration: { userId: UserId.make("owner-1"), token: "test-account-generation" },
					},
				});

				expect(Result.getFailure(declared)).toEqual(
					Option.some({
						message: "ensureUserEntities is available only to pinned system user bootstrap scripts",
					}),
				);
			}),
		);
	});
});

describe("toSandboxCreateEventsResult", () => {
	it.effect("preserves policy failures at the sandbox host boundary", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(
				toSandboxCreateEventsResult({
					count: 0,
					outcomes: [],
					warnings: [],
					failure: {
						index: 0,
						reason: { code: "policy-execution-failed", runId: AutomationRunId.make("run-1") },
					},
				}),
			);

			expect(Result.getFailure(result)).toEqual(
				Option.some("Event creation failed: policy-execution-failed"),
			);
		}),
	);
});
