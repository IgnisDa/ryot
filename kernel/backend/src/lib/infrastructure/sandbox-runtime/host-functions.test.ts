import { describe, expect, it, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	RelationshipId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
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
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	ingestionTestRevision,
	ingestionTestSource,
} from "#modules/imports/ingestion.test-support";
import type { ImportSourceExecutionSettings } from "#modules/imports/runtime/source-state";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ImportRunError } from "#modules/imports/runtime/workflow-errors";
import { IntegrationsRepository, type IntegrationRecord } from "#modules/integrations/repository";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipMutationPipeline } from "#modules/relationships/mutation-pipeline";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";
import { SandboxRepository } from "#modules/sandbox/repository";

import { makeAdditionalSandboxApiFunctions, toSandboxCreateEventsResult } from "./host-functions";

const userSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		timezone: {
			type: "string",
			label: "Timezone",
			description: "Timezone used by import normalization",
		},
	},
} as const;

const integrationRunExecutionSettings = (connectionId: string): ImportSourceExecutionSettings => ({
	userSettings: {},
	integration: {
		minimumProgress: 0,
		maximumProgress: 100,
		syncOwnership: false,
		providerSpecifics: { account: connectionId },
	},
});

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
	pluginInstallationId: "installation-1",
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
	principalFacts: Omit<Partial<SandboxExecutionPrincipal>, "metadata"> & {
		readonly metadata?: Omit<SandboxScriptMetadata, "runtimeImports">;
	} = {},
): SandboxRunInput => {
	const { metadata, ...otherPrincipalFacts } = principalFacts;
	return {
		compiledCode: "",
		compiledFormat: 1,
		lane: "interactive",
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
			metadata: { runtimeImports: [], capabilities: [...capabilities], ...metadata },
			...otherPrincipalFacts,
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
	};
};

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
			lane: "interactive",
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
		readonly eventMutations: Effect.Effect<ReadonlyArray<unknown>>;
		readonly ryotqlUserCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly ryotqlPluginCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly pluginConfigLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly createdRelationships: Effect.Effect<ReadonlyArray<unknown>>;
		readonly deletedRelationships: Effect.Effect<ReadonlyArray<unknown>>;
		readonly integrationLookups: Effect.Effect<ReadonlyArray<GetForUserInput>>;
		readonly sourceStateLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly installationLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly lookupOrder: Effect.Effect<ReadonlyArray<string>>;
		readonly oauthTokenRequests: Effect.Effect<ReadonlyArray<unknown>>;
		readonly oauthTokenInvalidations: Effect.Effect<ReadonlyArray<unknown>>;
		readonly useDefinitions: (source: DefinitionSource) => Effect.Effect<void>;
	}
>()("test/HostFunctionCalls") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const eventStreamWorkServiceLayer = (request: EventStreamWorkService["Service"]["request"]) =>
	Layer.succeed(
		EventStreamWorkService,
		EventStreamWorkService.of({
			request,
			fail: () => Effect.die("Unexpected EventStreamWorkService.fail"),
			claim: () => Effect.die("Unexpected EventStreamWorkService.claim"),
			process: () => Effect.die("Unexpected EventStreamWorkService.process"),
			dispatch: () => Effect.die("Unexpected EventStreamWorkService.dispatch"),
			reconcile: () => Effect.die("Unexpected EventStreamWorkService.reconcile"),
		}),
	);

const hostFunctionsLayer = (
	options: {
		readonly definitions?: DefinitionSource;
		readonly forbidRelationshipWrites?: boolean;
		readonly entityScope?: typeof builtinEntityScope;
		readonly integration?: (input: GetForUserInput) => Effect.Effect<IntegrationRecord | null>;
		readonly pluginConfig?: PluginRuntimeResolver["Service"]["resolvePluginConfigContext"];
		readonly oauthAccessToken?: OAuthConnectionsService["Service"]["accessTokenForIntegrationRun"];
		readonly oauthAccessTokenInvalidation?: OAuthConnectionsService["Service"]["invalidateAccessTokenForIntegrationRun"];
		readonly executionSettings?: (runId: string) => ImportSourceExecutionSettings;
		readonly liveUserSettings?: Record<string, JsonValue> | (() => Record<string, JsonValue>);
		readonly sourceStateUnavailable?: boolean;
		readonly sourceStateRunId?: string;
		readonly installationUnavailable?: boolean;
		readonly eventStreamRequest?: EventStreamWorkService["Service"]["request"];
		readonly resolveWorkflowCallScript?: SandboxRepository["Service"]["resolveWorkflowCallScript"];
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
			const sourceStateLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const installationLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const eventMutations = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const lookupOrder = yield* Ref.make<ReadonlyArray<string>>([]);
			const oauthTokenRequests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const oauthTokenInvalidations = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const snapshot = yield* Ref.make(
				buildDefinitionSnapshot(options.definitions ?? kernelDefinitionSource()),
			);
			const dependencies = Layer.mergeAll(
				hostDatabaseLayer,
				AuthRepository.layer.pipe(Layer.provide(hostDatabaseLayer)),
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.mock(EventsService)({
					updateBatch: (items, userId, command) =>
						append(eventMutations, { items, userId, command, kind: "update" }).pipe(
							Effect.as({ warnings: [], count: items.length }),
						),
					deleteBatch: (eventIds, userId, command) =>
						append(eventMutations, { userId, command, eventIds, kind: "delete" }).pipe(
							Effect.as({ warnings: [], count: eventIds.length }),
						),
				}),
				eventStreamWorkServiceLayer(
					options.eventStreamRequest ??
						(() => Effect.die("Unexpected EventStreamWorkService.request")),
				),
				Layer.mock(SandboxRepository)({
					resolveWorkflowCallScript:
						options.resolveWorkflowCallScript ?? (() => Effect.succeed(null)),
				}),
				Layer.succeed(HostFunctionCalls, {
					lookupOrder: Ref.get(lookupOrder),
					eventMutations: Ref.get(eventMutations),
					ensuredEntities: Ref.get(ensuredEntities),
					ryotqlUserCalls: Ref.get(ryotqlUserCalls),
					ryotqlPluginCalls: Ref.get(ryotqlPluginCalls),
					integrationLookups: Ref.get(integrationLookups),
					sourceStateLookups: Ref.get(sourceStateLookups),
					oauthTokenRequests: Ref.get(oauthTokenRequests),
					installationLookups: Ref.get(installationLookups),
					pluginConfigLookups: Ref.get(pluginConfigLookups),
					createdRelationships: Ref.get(createdRelationships),
					deletedRelationships: Ref.get(deletedRelationships),
					oauthTokenInvalidations: Ref.get(oauthTokenInvalidations),
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
						append(lookupOrder, "integration").pipe(
							Effect.andThen(append(integrationLookups, input)),
							Effect.andThen(
								options.integration ? options.integration(input) : Effect.die("unused"),
							),
						),
				}),
				Layer.mock(ImportSourceStateStore)({
					load: (scope) =>
						append(lookupOrder, "source-state").pipe(
							Effect.andThen(append(sourceStateLookups, scope)),
							Effect.andThen(
								Effect.suspend(() => {
									if (
										options.sourceStateUnavailable ||
										(options.sourceStateRunId !== undefined &&
											scope.runId !== options.sourceStateRunId)
									) {
										return Effect.fail(
											new ImportRunError({ message: "Admitted source state is unavailable" }),
										);
									}
									const { namedArtifactPaths: _namedArtifactPaths, ...source } =
										ingestionTestSource;
									return Effect.succeed({
										...source,
										files: {},
										pluginRevision: ingestionTestRevision,
										sourcePayload: { ...source.sourcePayload, integrationId: "int-trusted" },
										executionSettings: options.executionSettings?.(scope.runId) ?? {
											userSettings: {},
										},
									});
								}),
							),
						),
				}),
				Layer.mock(PluginInstallationRepository)({
					findUserSettingsForRevision: (input) =>
						append(lookupOrder, "installation").pipe(
							Effect.andThen(append(installationLookups, input)),
							Effect.andThen(() =>
								Effect.succeed(
									options.installationUnavailable
										? null
										: {
												installationId: "installation-1",
												manifest: { ...fixtureManifest(), userSettingsSchema },
												userSettings:
													typeof options.liveUserSettings === "function"
														? options.liveUserSettings()
														: (options.liveUserSettings ?? { timezone: "UTC" }),
											},
								),
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
					invalidateAccessTokenForIntegrationRun: (input) =>
						append(oauthTokenInvalidations, input).pipe(
							Effect.andThen(
								options.oauthAccessTokenInvalidation
									? options.oauthAccessTokenInvalidation(input)
									: Effect.die("unused OAuth access token invalidation"),
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

describe("event mutation capabilities", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("binds update and delete batches to the trusted execution user", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const trustedUser = UserId.make("trusted-user");
				const updateItems = [{ eventId: "event-1", patch: { entityId: "entity-1" } }];
				expect(
					yield* functions.updateEvents(
						runInput(
							{
								type: "user",
								userId: trustedUser,
								accountGeneration: { userId: trustedUser, token: "test-account-generation" },
							},
							["updateEvents"],
						),
						updateItems,
					),
				).toEqual({ count: 1 });
				expect(
					yield* functions.deleteEvents(
						runInput(automationSubject({ kind: "api" }), ["deleteEvents"]),
						["event-2"],
					),
				).toEqual({ count: 1 });
				expect(yield* (yield* HostFunctionCalls).eventMutations).toMatchObject([
					{
						kind: "update",
						items: updateItems,
						userId: trustedUser,
						command: {
							itemIdentity: "updateEvents",
							causation: { source: "api", initiator: { kind: "user", id: trustedUser } },
						},
					},
					{
						kind: "delete",
						eventIds: ["event-2"],
						userId: UserId.make("user-1"),
						command: {
							itemIdentity: "deleteEvents",
							causation: {
								source: "automation",
								initiator: { kind: "user", id: UserId.make("user-1") },
							},
						},
					},
				]);
			}),
		);
	});
});

describe("requestEventStreamWork", () => {
	const resolvedTargets: Array<unknown> = [];
	const requests: Array<unknown> = [];
	layer(
		hostFunctionsLayer({
			eventStreamRequest: (input) =>
				Effect.sync(() => requests.push(input)).pipe(Effect.as("event-stream-work-id")),
			resolveWorkflowCallScript: (pluginPin, request) =>
				Effect.sync(() => resolvedTargets.push({ request, pluginPin })).pipe(
					Effect.as({ kind: "script", scriptId: SandboxScriptId.make("processor-script") }),
				),
		}),
	)((test) => {
		test.effect("resolves and registers only the declared script under the trusted account", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const accountGeneration = { userId, token: "test-account-generation" };
				const subject = {
					userId,
					type: "user",
					accountGeneration,
				} satisfies SandboxExecutionSubject;
				const input = runInput(subject, ["requestEventStreamWork"], {
					pluginRevision: systemPluginRevision,
					metadata: {
						kind: "automation",
						capabilities: ["requestEventStreamWork"],
						executableDependencies: [{ kind: "script", slug: "stream-processor" }],
					},
				});
				const request = {
					outputProperties: ["value"],
					entityId: EntityId.make("entity-1"),
					eventSchemaSlug: EventSchemaSlug.make("event-stream"),
				};
				const reference = {
					referenceKind: "script",
					scriptSlug: "stream-processor",
				} satisfies Parameters<typeof functions.requestEventStreamWork>[2];

				expect(yield* functions.requestEventStreamWork(input, request, reference)).toEqual({
					workId: "event-stream-work-id",
				});
				expect(resolvedTargets).toEqual([
					{
						pluginPin: systemPluginRevision,
						request: {
							index: 0,
							kind: "activity",
							name: "event-stream-processor",
							args: { input: null, scriptSlug: "stream-processor" },
						},
					},
				]);
				expect(requests).toEqual([
					{
						request,
						accountGeneration,
						pluginPin: systemPluginRevision,
						processorScriptId: SandboxScriptId.make("processor-script"),
					},
				]);

				const undeclared = runInput(subject, ["requestEventStreamWork"], {
					pluginRevision: systemPluginRevision,
					metadata: { executableDependencies: [], capabilities: ["requestEventStreamWork"] },
				});
				const failure = yield* Effect.flip(
					functions.requestEventStreamWork(undeclared, request, reference),
				);
				expect(failure.message).toContain("not a declared script dependency");
				expect(requests).toHaveLength(1);
			}),
		);
	});
});

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
	principalFacts: Partial<SandboxExecutionPrincipal> = { pluginRevision: ingestionTestRevision },
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

const runInvalidateOAuthAccessToken = (
	subject: SandboxExecutionSubject,
	principalFacts: Partial<SandboxExecutionPrincipal> = { pluginRevision: ingestionTestRevision },
) =>
	makeAdditionalSandboxApiFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.invalidateOAuthAccessToken(
					runInput(subject, SANDBOX_HOST_CAPABILITIES, {
						...principalFacts,
						metadata: {
							oauthConnectionFields: ["account"],
							capabilities: SANDBOX_HOST_CAPABILITIES,
							...principalFacts.metadata,
						},
					}),
					{ field: "account", accessToken: "access-1" },
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
			executionSettings: () => integrationRunExecutionSettings("connection-1"),
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
						pluginId: "plugin-1",
						integrationId: "int-trusted",
						connectionId: "connection-1",
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
					{ subject: integrationRunSubject, principalFacts: { pluginRevision: null } },
					{
						subject: automationSubject({
							kind: "integration",
							integrationId: IntegrationId.make("int-trusted"),
						}),
					},
				];
				for (const { subject, principalFacts } of cases) {
					const result = yield* runGetOAuthAccessToken(
						subject,
						principalFacts ?? { pluginRevision: systemPluginRevision },
					);
					const failure = Option.getOrThrow(Result.getFailure(result));
					expect(failure.message).toContain("available only");
					expect(failure.data).toEqual({
						code: "unavailable-operation",
						operation: "getOAuthAccessToken",
					});
				}
				expect(yield* (yield* HostFunctionCalls).oauthTokenRequests).toEqual([]);
			}),
		);
	});
});

describe("invalidateOAuthAccessToken", () => {
	const integrationRunSubject = {
		type: "user",
		userId: UserId.make("user-1"),
		integrationId: IntegrationId.make("int-trusted"),
		integrationRunId: ImportRunId.make("run-trusted"),
		accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
	} satisfies SandboxExecutionSubject;

	layer(
		hostFunctionsLayer({
			oauthAccessTokenInvalidation: () => Effect.succeed(null),
			executionSettings: () => integrationRunExecutionSettings("connection-1"),
		}),
	)((test) => {
		test.effect("forwards the trusted integration run scope and supplied access token", () =>
			Effect.gen(function* () {
				const result = yield* runInvalidateOAuthAccessToken(integrationRunSubject);

				expect(Result.getOrThrow(result)).toBeNull();
				expect(yield* (yield* HostFunctionCalls).oauthTokenInvalidations).toEqual([
					{
						field: "account",
						userId: "user-1",
						pluginId: "plugin-1",
						accessToken: "access-1",
						integrationId: "int-trusted",
						connectionId: "connection-1",
						integrationRunId: "run-trusted",
					},
				]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects invalidation outside an integration's plugin run", () =>
			Effect.gen(function* () {
				const result = yield* runInvalidateOAuthAccessToken({
					type: "user",
					userId: UserId.make("user-1"),
					accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
				});
				const failure = Option.getOrThrow(Result.getFailure(result));

				expect(failure.message).toContain("available only");
				expect(failure.data).toEqual({
					code: "unavailable-operation",
					operation: "invalidateOAuthAccessToken",
				});
				expect(yield* (yield* HostFunctionCalls).oauthTokenInvalidations).toEqual([]);
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

							const failure = Option.getOrThrow(Result.getFailure(result));
							expect(failure.message).toContain("available only");
							expect(failure.data).toEqual({
								code: "unavailable-operation",
								operation: "getCurrentIntegration",
							});
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

	const selectedSettings = {
		minimumProgress: 10,
		maximumProgress: 80,
		syncOwnership: false,
		providerSpecifics: { filter: "movie", provider: "tmdb", kind: "lambda_yank" },
	};
	const changedSettings = {
		syncOwnership: true,
		minimumProgress: 20,
		maximumProgress: 90,
		providerSpecifics: { filter: "show", provider: "tvdb", kind: "lambda_yank" },
	};
	let liveIntegrationSettings = {
		minimumProgress: 1,
		maximumProgress: 99,
		syncOwnership: false,
		providerSpecifics: { filter: "live", provider: "live", kind: "lambda_yank" },
	};
	layer(
		hostFunctionsLayer({
			integration: (input) =>
				Effect.succeed({ ...ownedIntegration(input), ...liveIntegrationSettings }),
			executionSettings: (runId) => ({
				userSettings: {},
				integration: runId === "run-1" ? selectedSettings : changedSettings,
			}),
		}),
	)((test) => {
		test.effect(
			"uses the admitted integration settings while later runs use their own snapshot",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalSandboxApiFunctions;
					const userId = UserId.make("user-1");
					const integrationId = IntegrationId.make("int-trusted");
					const readForRun = (runId: string) =>
						functions.getCurrentIntegration({
							...runInput(
								{
									userId,
									type: "user",
									integrationId,
									integrationRunId: ImportRunId.make(runId),
									accountGeneration: { userId, token: "test-account-generation" },
								},
								SANDBOX_HOST_CAPABILITIES,
								{ pluginRevision: ingestionTestRevision },
							),
							executionId: `${runId}-import`,
						});
					const firstRead = yield* readForRun("run-1");
					liveIntegrationSettings = {
						syncOwnership: true,
						minimumProgress: 30,
						maximumProgress: 70,
						providerSpecifics: { provider: "tvdb", filter: "changed", kind: "lambda_yank" },
					};
					const activeRun = yield* readForRun("run-1");
					const nextRun = yield* readForRun("run-2");

					expect(firstRead.providerSpecifics).toEqual({
						filter: "movie",
						provider: "tmdb",
						kind: "lambda_yank",
					});
					expect(activeRun.providerSpecifics).toEqual({
						filter: "movie",
						provider: "tmdb",
						kind: "lambda_yank",
					});
					expect(activeRun.minimumProgress).toBe(10);
					expect(activeRun.maximumProgress).toBe(80);
					expect(activeRun.syncOwnership).toBe(false);
					expect(nextRun.providerSpecifics).toEqual({
						filter: "show",
						provider: "tvdb",
						kind: "lambda_yank",
					});
					expect(nextRun.minimumProgress).toBe(20);
					expect(nextRun.maximumProgress).toBe(90);
					expect(nextRun.syncOwnership).toBe(true);
					expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toEqual(
						["run-1", "run-1", "run-2"].map((runId) => ({
							runId,
							userId,
							accountGeneration: { userId, token: "test-account-generation" },
						})),
					);
					expect(yield* (yield* HostFunctionCalls).lookupOrder).toEqual(
						Array.from({ length: 3 }, () => ["integration", "source-state"]).flat(),
					);
				}),
		);
	});
});

describe("getUserSettings", () => {
	layer(hostFunctionsLayer({ liveUserSettings: { timezone: "UTC" } }))((test) => {
		test.effect("keeps non-ingestion settings live", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				expect(
					yield* functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: systemPluginRevision },
						),
						context: { runId: "run-1" },
						executionId: "run-1-import",
					}),
				).toEqual({ timezone: "UTC" });
			}),
		);
	});
	let liveUserSettings: Record<string, JsonValue> = { timezone: "UTC" };
	layer(
		hostFunctionsLayer({
			liveUserSettings: () => liveUserSettings,
			executionSettings: (runId) => ({
				userSettings: { timezone: runId === "run-1" ? "America/Los_Angeles" : "Asia/Tokyo" },
			}),
		}),
	)((test) => {
		test.effect("uses the accepted timezone for child and durable host executions", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const readForRun = (runId: string, executionId: string, context: Record<string, unknown>) =>
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make(runId),
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: ingestionTestRevision },
						),
						context,
						executionId,
					});
				expect(yield* readForRun("run-1", "run-1-import-child-collect-0", {})).toEqual({
					timezone: "America/Los_Angeles",
				});
				liveUserSettings = { timezone: "Europe/Paris" };
				expect(yield* readForRun("run-1", "run-1-import-host-1", { runId: "forged-run" })).toEqual({
					timezone: "America/Los_Angeles",
				});
				expect(
					yield* readForRun("run-2", "run-2-import-child-collect-0", { runId: "run-1" }),
				).toEqual({ timezone: "Asia/Tokyo" });
				expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toEqual(
					["run-1", "run-1", "run-2"].map((runId) => ({
						runId,
						userId,
						accountGeneration: { userId, token: "test-account-generation" },
					})),
				);
				expect(yield* (yield* HostFunctionCalls).installationLookups).toMatchObject(
					[0, 1, 2].map(() => ({ userId, pluginId: "plugin-1", pluginRevisionId: "revision-1" })),
				);
				expect(yield* (yield* HostFunctionCalls).lookupOrder).toEqual(
					Array.from({ length: 3 }, () => ["installation", "source-state"]).flat(),
				);
			}),
		);
	});
	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects admitted settings from a different pinned plugin", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: systemPluginRevision },
						),
						context: { runId: "forged-run" },
						executionId: "run-1-import-host-1",
					}),
				);

				expect(Option.getOrThrow(Result.getFailure(result)).message).toBe(
					"Admitted ingestion execution settings are unavailable",
				);
			}),
		);
	});
	layer(hostFunctionsLayer({ installationUnavailable: true }))((test) => {
		test.effect("rejects admitted settings after the live installation is deleted", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: ingestionTestRevision },
						),
						executionId: "run-1-import-host-1",
					}),
				);

				expect(Option.getOrThrow(Result.getFailure(result)).message).toBe(
					"Plugin installation not found",
				);
			}),
		);
	});
	layer(hostFunctionsLayer({ sourceStateRunId: "run-1" }))((test) => {
		test.effect("rejects a run ID that does not own the accepted settings snapshot", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("different-run"),
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: ingestionTestRevision },
						),
						context: { runId: "run-1" },
						executionId: "run-1-import-host-1",
					}),
				);

				expect(Option.getOrThrow(Result.getFailure(result)).message).toBe(
					"Admitted ingestion execution settings are unavailable",
				);
				expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toEqual([
					{
						userId,
						runId: "different-run",
						accountGeneration: { userId, token: "test-account-generation" },
					},
				]);
			}),
		);
	});
	layer(hostFunctionsLayer({ sourceStateUnavailable: true }))((test) => {
		test.effect("does not fall back to live settings for an admitted import", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalSandboxApiFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: { userId, token: "test-account-generation" },
							},
							["getUserSettings"],
							{ pluginRevision: ingestionTestRevision },
						),
						context: { runId: "forged-run" },
						executionId: "run-1-import-host-1",
					}),
				);
				expect(Option.getOrThrow(Result.getFailure(result)).message).toBe(
					"Admitted ingestion execution settings are unavailable",
				);
				expect(yield* (yield* HostFunctionCalls).installationLookups).toHaveLength(1);
				expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toHaveLength(1);
				expect(yield* (yield* HostFunctionCalls).lookupOrder).toEqual([
					"installation",
					"source-state",
				]);
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

	layer(hostFunctionsLayer({ pluginConfig: () => Effect.succeed({}) }))((test) => {
		test.effect("returns a boundary reason for missing required configuration", () =>
			Effect.gen(function* () {
				const result = yield* runGetPluginConfig({
					pluginRevision: { ...systemPluginRevision, configSchema: pluginConfigSchema },
				});
				const failure = Option.getOrThrow(Result.getFailure(result));

				expect(failure.message).toContain("not configured");
				expect(failure.data).toEqual({ keys: ["apiToken"], code: "missing-required-config" });
			}),
		);
	});

	layer(hostFunctionsLayer({ pluginConfig: () => Effect.die("must not resolve unpinned config") }))(
		(test) => {
			test.effect("rejects config access before resolving without a trusted pin", () =>
				Effect.gen(function* () {
					const result = yield* runGetPluginConfig({});

					const failure = Option.getOrThrow(Result.getFailure(result));
					expect(failure.message).toContain("active plugin scripts");
					expect(failure.data).toEqual({
						operation: "getPluginConfig",
						code: "unavailable-operation",
					});
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
						metadata: { kind: "script", runtimeImports: [], capabilities: ["executeRyotql"] },
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
						metadata: { kind: "script", runtimeImports: [], capabilities: ["executeRyotql"] },
					},
				});

				const failure = Option.getOrThrow(Result.getFailure(result));
				expect(failure.message).toContain("pinned system plugin script");
				expect(failure.data).toEqual({ operation: "executeRyotql", code: "unavailable-operation" });
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
				metadata: { kind: "script", runtimeImports: [], capabilities: ["executeRyotql"] },
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

				const systemFailure = Option.getOrThrow(Result.getFailure(system));
				expect(systemFailure.message).toContain("not available for system executions");
				expect(systemFailure.data).toEqual({
					code: "unavailable-operation",
					operation: "changeUserRelationships",
				});
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

				for (const [result, message] of [
					[delegated, "available only to user executions"],
					[system, "not available for system executions"],
					[untrusted, "available only to pinned system user bootstrap scripts"],
				] as const) {
					const failure = Option.getOrThrow(Result.getFailure(result));
					expect(failure.message).toContain(message);
					expect(failure.data).toEqual({
						code: "unavailable-operation",
						operation: "ensureUserEntities",
					});
				}
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

				const failure = Option.getOrThrow(Result.getFailure(declared));
				expect(failure.message).toContain("available only to pinned system user bootstrap scripts");
				expect(failure.data).toEqual({
					code: "unavailable-operation",
					operation: "ensureUserEntities",
				});
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
