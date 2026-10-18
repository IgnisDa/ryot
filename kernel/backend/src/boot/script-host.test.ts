import { describe, expect, it, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	definitionKey,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventId,
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
import type { ChangeUserRelationshipBatch } from "@ryot-app/plugin-backend-sdk/core";
import { testAccountGeneration } from "@ryot-app/sandbox/host/run-input.test-support";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Ref, Result } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { withLifecycleBatchPlanning } from "#modules/automations/lifecycle.test-support";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { BackgroundWorkService } from "#modules/background-work/service";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { buildDefinitionSnapshot, type DefinitionSource } from "#modules/definitions/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import {
	type DomainLifecycleCommand,
	DomainWriteChecksLive,
} from "#modules/entities/write-context";
import { toSandboxCreateEventsResult } from "#modules/events/script-host";
import { EventsService } from "#modules/events/service";
import { EventStreamWorkService } from "#modules/events/stream-work";
import {
	ingestionTestRevision,
	ingestionTestSource,
} from "#modules/imports/ingestion.test-support";
import type { ImportSourceExecutionSettings } from "#modules/imports/runtime/source-state";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ImportRunError } from "#modules/imports/runtime/workflow-errors";
import { type IntegrationRecord, IntegrationsRepository } from "#modules/integrations/repository";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipMutationPipeline } from "#modules/relationships/mutation-pipeline";
import {
	relationshipMutationLockKey,
	RelationshipsRepository,
} from "#modules/relationships/repository";
import { RyotQLService } from "#modules/ryotql/service";
import type { ScriptRunInput } from "#modules/scripts/authorization/capabilities";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxSubmissionCommands } from "#modules/scripts/host/submission-command";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { UserCommands } from "#modules/user-commands/service";
import { DatabaseSession } from "#platform/db/session";
import { ProKeyService } from "#platform/pro-key";
import { RedisService } from "#platform/redis";
import { user } from "#schema/tables/auth";
import { makeAppConfigLayer, makeRedisService, workflowEngineTestLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { makeAdditionalScriptHostFunctions } from "./script-host";

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
	principalFacts: Omit<Partial<ScriptExecutionPrincipal>, "metadata"> & {
		readonly metadata?: Omit<SandboxScriptMetadata, "runtimeImports">;
	} = {},
): ScriptRunInput => {
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
			...(otherPrincipalFacts.pluginRevision ? {} : { kernelScript: true as const }),
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
		delivery: "required",
		type: "automation-run",
		pluginRevisionId: null,
		pluginConfigRevisionId: null,
		runId: AutomationRunId.make("run-1"),
		executionUserId: UserId.make("user-1"),
		triggerId: AutomationTriggerId.make("trigger-1"),
		accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
	entitySchemaSlugs: ["example"],
	relationshipSchemaSlugs: ["example-monitoring"],
};

const systemPluginRevision = {
	ownerId: null,
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-id"),
	packageId: fixtureManifest().metadata.packageId,
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: {
		signalSchemaSlugs: [],
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

type RecordedUserDataMerge = {
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly payload: { mergeFrom: string; mergeInto: string; entitySchemaSlug: string };
};

class HostFunctionCalls extends Context.Service<
	HostFunctionCalls,
	{
		readonly createdEntities: Effect.Effect<ReadonlyArray<unknown>>;
		readonly userDataMerges: Effect.Effect<ReadonlyArray<RecordedUserDataMerge>>;
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
		readonly userSettingsPatches: Effect.Effect<ReadonlyArray<unknown>>;
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
			failed: () => Effect.die("Unexpected EventStreamWorkService.failed"),
			process: () => Effect.die("Unexpected EventStreamWorkService.process"),
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
			const createdEntities = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const userDataMerges = yield* Ref.make<ReadonlyArray<RecordedUserDataMerge>>([]);
			const ensuredEntities = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const ryotqlUserCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const ryotqlPluginCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const pluginConfigLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const createdRelationships = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const deletedRelationships = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const integrationLookups = yield* Ref.make<ReadonlyArray<GetForUserInput>>([]);
			const sourceStateLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const installationLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const userSettingsPatches = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const eventMutations = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const lookupOrder = yield* Ref.make<ReadonlyArray<string>>([]);
			const oauthTokenRequests = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const oauthTokenInvalidations = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const snapshot = yield* Ref.make(
				buildDefinitionSnapshot(options.definitions ?? kernelDefinitionSource()),
			);
			const dependencies = Layer.mergeAll(
				workflowEngineTestLayer,
				hostDatabaseLayer,
				AuthRepository.layer.pipe(Layer.provide(hostDatabaseLayer)),
				DomainWriteChecksLive.pipe(Layer.provide(hostDatabaseLayer)),
				makeAppConfigLayer(),
				Layer.succeed(RedisService, makeRedisService()),
				Layer.succeed(
					ManagedAssetsService,
					ManagedAssetsService.of({
						cleanupManagedAsset: () => Effect.die("Unexpected asset cleanup"),
						resolveDownloads: () => Effect.die("Unexpected download resolution"),
						registerManagedAsset: () => Effect.die("Unexpected asset registration"),
						listManagedAssetsForOwner: () => Effect.die("Unexpected asset listing"),
						cleanupStagedPermanentAsset: () => Effect.die("Unexpected asset cleanup"),
						stageContentAddressedPermanentAsset: () => Effect.die("Unexpected asset staging"),
						verifyManagedAssetOwnership: () =>
							Effect.die("Unexpected asset ownership verification"),
						registerManagedAssetInLockedTransaction: () =>
							Effect.die("Unexpected asset registration"),
					}),
				),
				Layer.succeed(ProKeyService, ProKeyService.of({ isValidated: Effect.succeed(false) })),
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
					userDataMerges: Ref.get(userDataMerges),
					createdEntities: Ref.get(createdEntities),
					ensuredEntities: Ref.get(ensuredEntities),
					ryotqlUserCalls: Ref.get(ryotqlUserCalls),
					ryotqlPluginCalls: Ref.get(ryotqlPluginCalls),
					integrationLookups: Ref.get(integrationLookups),
					sourceStateLookups: Ref.get(sourceStateLookups),
					oauthTokenRequests: Ref.get(oauthTokenRequests),
					installationLookups: Ref.get(installationLookups),
					userSettingsPatches: Ref.get(userSettingsPatches),
					pluginConfigLookups: Ref.get(pluginConfigLookups),
					createdRelationships: Ref.get(createdRelationships),
					deletedRelationships: Ref.get(deletedRelationships),
					oauthTokenInvalidations: Ref.get(oauthTokenInvalidations),
					useDefinitions: (source) => Ref.set(snapshot, buildDefinitionSnapshot(source)),
				}),
				Layer.mock(DefinitionRepository)({
					getSnapshotForContext: () => Ref.get(snapshot),
					findUserEntitySchemas: () => Effect.map(Ref.get(snapshot), (all) => all.entitySchemas),
					findUserRelationshipSchemas: () =>
						Effect.map(Ref.get(snapshot), (all) => all.relationshipSchemas),
					findGlobalRelationshipSchema: (reference) =>
						Effect.map(
							Ref.get(snapshot),
							(all) =>
								all.relationshipSchemas[
									definitionKey("relationship", reference.owner, reference.slug)
								] ?? null,
						),
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
												userSettingsSchema,
												installationId: "installation-1",
												userSettings:
													typeof options.liveUserSettings === "function"
														? options.liveUserSettings()
														: (options.liveUserSettings ?? { timezone: "UTC" }),
											},
								),
							),
						),
				}),
				Layer.mock(PluginUserSettingsWriter)({
					patch: (input) => append(userSettingsPatches, input),
				}),
				Layer.mock(EntityUserDataService)({
					mergeEntityUserDataForCommand: (userId, payload, command) =>
						append(userDataMerges, { userId, payload, command }).pipe(
							Effect.as({
								...payload,
								warnings: [],
								movedEventsCount: 2,
								movedRelationshipsCount: 3,
							}),
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
					getMutationEntities: () => Effect.succeed(new Map()),
					getEntityScopeForUser: options.entityScope ?? builtinEntityScope,
					getEntityScopesForUser: (entityIds, userId) =>
						Effect.forEach(entityIds, (entityId) =>
							(options.entityScope ?? builtinEntityScope)({ userId, entityId }),
						).pipe(
							Effect.map(
								(scopes) =>
									new Map(scopes.flatMap((scope) => (scope ? [[scope.entityId, scope]] : []))),
							),
						),
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
					create: (input) =>
						append(createdEntities, input).pipe(
							Effect.as({
								warnings: [],
								entity: {
									name: input.name,
									externalId: null,
									providerId: null,
									populatedAt: null,
									properties: input.properties,
									id: EntityId.make("created-id"),
									createdAt: "2026-01-01T00:00:00.000Z",
									updatedAt: "2026-01-01T00:00:00.000Z",
									entitySchemaSlug: input.entitySchema.slug,
									entitySchemaPluginId: definitionOwnerPluginId(input.entitySchema.owner),
								},
							}),
						),
				}),
				Layer.mock(RelationshipsRepository)({
					findRelationship: () => Effect.succeed(null),
					lockRelationshipMutations: () => Effect.void,
					findRelationships: () => Effect.succeed(new Map()),
					updateRelationshipsById: () => Effect.succeed(new Map()),
					deleteRelationshipsById: (ids) =>
						Effect.forEach(ids, (id) => append(deletedRelationships, id), { discard: true }).pipe(
							Effect.as(new Map()),
						),
					createRelationships: (inputs) =>
						options.forbidRelationshipWrites && inputs.length > 0
							? Effect.die("must not write")
							: Effect.forEach(inputs, (input) =>
									append(createdRelationships, input).pipe(
										Effect.as([
											relationshipMutationLockKey(input),
											{
												...input,
												wasInserted: true,
												createdAt: "2026-07-28T00:00:00.000Z",
												updatedAt: "2026-07-28T00:00:00.000Z",
												id: RelationshipId.make("relationship-1"),
												relationshipSchemaPluginId:
													input.relationshipSchemaPluginId === null
														? null
														: PluginId.make(input.relationshipSchemaPluginId),
											},
										] as const),
									),
								).pipe(Effect.map((saved) => new Map(saved))),
				}),
			);
			return Layer.mergeAll(
				BackgroundWorkService.layer,
				RelationshipMutationPipeline.layer,
				SandboxSubmissionCommands.layer,
				Layer.succeed(UserCommands, { commit: () => Effect.die("Unexpected atomic command") }),
			).pipe(Layer.provideMerge(dependencies));
		}),
	);

const runGetCurrentIntegration = (subject: SandboxExecutionSubject) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.getCurrentIntegration(runInput(subject))),
		),
	);

describe("event mutation capabilities", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("binds update and delete batches to the trusted execution user", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalScriptHostFunctions;
				const trustedUser = UserId.make("trusted-user");
				const updateItems = [{ eventId: "event-1", patch: { entityId: "entity-1" } }];
				expect(
					yield* functions.updateEvents(
						runInput(
							{
								type: "user",
								userId: trustedUser,
								accountGeneration: testAccountGeneration(trustedUser),
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const accountGeneration = testAccountGeneration(userId);
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
						command: expect.objectContaining({
							writeContext: input.principal,
							itemIdentity: "requestEventStreamWork",
						}),
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

describe("getUserPreferences", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("reads authoritative preferences and preserves missing-user failures", () =>
			Effect.gen(function* () {
				const auth = yield* AuthRepository;
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				yield* auth.patchUserPreferences(userId, { disableIntegrations: true });
				expect(
					yield* functions.getUserPreferences(
						runInput({ userId, type: "user", accountGeneration: testAccountGeneration(userId) }),
					),
				).toEqual({ disableIntegrations: true });
				expect(
					yield* Effect.flip(
						functions.getUserPreferences(
							runInput({
								type: "user",
								userId: UserId.make("missing"),
								accountGeneration: testAccountGeneration(UserId.make("missing")),
							}),
						),
					),
				).toEqual({ message: "User not found" });
			}),
		);

		test.effect("reports malformed preferences through the host boundary", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const functions = yield* makeAdditionalScriptHostFunctions;
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
											accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
				const functions = yield* makeAdditionalScriptHostFunctions.pipe(
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
	principalFacts: Partial<ScriptExecutionPrincipal> = { pluginRevision: ingestionTestRevision },
) =>
	makeAdditionalScriptHostFunctions.pipe(
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
	principalFacts: Partial<ScriptExecutionPrincipal> = { pluginRevision: ingestionTestRevision },
) =>
	makeAdditionalScriptHostFunctions.pipe(
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
		accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
							accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
		accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
					accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
						accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
							accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
					accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
		providerSpecifics: { filter: "item", kind: "lambda_yank", provider: "provider" },
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
					const functions = yield* makeAdditionalScriptHostFunctions;
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
									accountGeneration: testAccountGeneration(userId),
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
						filter: "item",
						kind: "lambda_yank",
						provider: "provider",
					});
					expect(activeRun.providerSpecifics).toEqual({
						filter: "item",
						kind: "lambda_yank",
						provider: "provider",
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
							accountGeneration: testAccountGeneration(userId),
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				expect(
					yield* functions.getUserSettings({
						...runInput(
							{ userId, type: "user", accountGeneration: testAccountGeneration(userId) },
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const readForRun = (runId: string, executionId: string, context: Record<string, unknown>) =>
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make(runId),
								accountGeneration: testAccountGeneration(userId),
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
						accountGeneration: testAccountGeneration(userId),
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: testAccountGeneration(userId),
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: testAccountGeneration(userId),
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
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("different-run"),
								accountGeneration: testAccountGeneration(userId),
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
					{ userId, runId: "different-run", accountGeneration: testAccountGeneration(userId) },
				]);
			}),
		);
	});
	layer(hostFunctionsLayer({ sourceStateUnavailable: true }))((test) => {
		test.effect("does not fall back to live settings for an admitted import", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalScriptHostFunctions;
				const userId = UserId.make("user-1");
				const result = yield* Effect.result(
					functions.getUserSettings({
						...runInput(
							{
								userId,
								type: "user",
								importRunId: ImportRunId.make("run-1"),
								accountGeneration: testAccountGeneration(userId),
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

const runGetPluginConfig = (principalFacts: Partial<ScriptExecutionPrincipal>) =>
	makeAdditionalScriptHostFunctions.pipe(
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

const settingsUserId = UserId.make("user-1");
const settingsUserSubject = {
	type: "user",
	userId: settingsUserId,
	accountGeneration: testAccountGeneration(settingsUserId),
} satisfies SandboxExecutionSubject;
const settingsWriteInput = (
	subject: SandboxExecutionSubject,
	principalFacts: Parameters<typeof runInput>[2] = { pluginRevision: systemPluginRevision },
	capabilities: readonly string[] = ["updateUserSettings"],
) => runInput(subject, capabilities, principalFacts);

describe("updateUserSettings", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect("patches the calling plugin's installation for the execution user", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalScriptHostFunctions;
				expect(
					yield* functions.updateUserSettings(
						{
							...settingsWriteInput(settingsUserSubject),
							context: { userId: "other-user", pluginId: "other-plugin" },
						},
						{ timezone: "Europe/Paris" },
					),
				).toEqual({ saved: true });
				expect(yield* (yield* HostFunctionCalls).userSettingsPatches).toEqual([
					{
						userId: settingsUserId,
						pluginId: systemPluginRevision.id,
						values: { timezone: "Europe/Paris" },
						pluginRevisionId: systemPluginRevision.revisionId,
						accountGeneration: testAccountGeneration(settingsUserId),
					},
				]);
			}),
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect("rejects executions that cannot own a user settings write", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalScriptHostFunctions;
				const unavailable =
					"Plugin user settings cannot be written by integration, import, or bootstrap executions";
				const cases = [
					{
						message: "updateUserSettings is not declared by this script",
						input: settingsWriteInput(
							settingsUserSubject,
							{ pluginRevision: systemPluginRevision },
							["getUserSettings"],
						),
					},
					{
						input: settingsWriteInput(automationSubject({ kind: "api" })),
						message: "updateUserSettings is available only to user executions",
					},
					{
						input: settingsWriteInput({ type: "system" }),
						message: "updateUserSettings is not available for system executions",
					},
					{
						input: settingsWriteInput(settingsUserSubject, {}),
						message: "Plugin user settings require a plugin execution",
					},
					{
						message: unavailable,
						input: settingsWriteInput({
							...settingsUserSubject,
							integrationId: IntegrationId.make("int-1"),
						}),
					},
					{
						message: unavailable,
						input: settingsWriteInput({
							...settingsUserSubject,
							importRunId: ImportRunId.make("run-1"),
						}),
					},
					{
						message: unavailable,
						input: settingsWriteInput({
							...settingsUserSubject,
							integrationRunId: ImportRunId.make("run-1"),
						}),
					},
					{
						message: unavailable,
						input: settingsWriteInput(settingsUserSubject, {
							metadata: { kind: "script", capabilities: ["updateUserSettings"] },
							pluginRevision: { ...systemPluginRevision, userBootstrapScriptSlugs: ["script"] },
						}),
					},
					{
						message: unavailable,
						input: settingsWriteInput(settingsUserSubject, {
							pluginRevision: systemPluginRevision,
							initialization: { activationId: "activation-1", installationId: "installation-1" },
						}),
					},
				];
				for (const { input, message } of cases) {
					const failure = yield* Effect.flip(
						functions.updateUserSettings(input, { timezone: "UTC" }),
					);
					expect(failure.message).toBe(message);
					expect(failure.data).toEqual({
						code: "unavailable-operation",
						operation: "updateUserSettings",
					});
				}
				expect(yield* (yield* HostFunctionCalls).userSettingsPatches).toEqual([]);
			}),
		);
	});
});

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

const runExecuteRyotql = (input: ScriptRunInput, document: RyotQLDocument = ryotqlDocument) =>
	makeAdditionalScriptHostFunctions.pipe(
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
					signalSchemaSlugs: [],
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
							signalSchemaSlugs: [],
							entitySchemaSlugs: ["example"],
							pluginId: systemPluginRevision.id,
							relationshipSchemaSlugs: ["example-monitoring"],
							pluginRevisionId: systemPluginRevision.revisionId,
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
						accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
});

const runChangeUserRelationships = (
	subject: SandboxExecutionSubject,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
) =>
	makeAdditionalScriptHostFunctions.pipe(
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
	const batch = {
		deletes: [],
		creates: [{ ...identity, properties: {}, propertiesMode: "replace" as const }],
	};

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
						propertiesMode: "replace",
						sourceEntityId: "entity-1",
						targetEntityId: "collection-1",
						relationshipSchemaPluginId: null,
						relationshipSchemaSlug: "member-of",
						relationshipSchema: { slug: "member-of", owner: { kind: "kernel" } },
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
						propertiesMode: "replace",
						sourceEntityId: "entity-1",
						targetEntityId: "collection-1",
						relationshipSchemaPluginId: null,
						relationshipSchemaSlug: "member-of",
						relationshipSchema: { slug: "member-of", owner: { kind: "kernel" } },
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
	calendarSources: [],
	relationshipSchemas: [],
	entitySchemas: [
		{
			icon: "box",
			eventSchemas: [],
			slug: "workspace",
			name: "Workspace",
			pluginId: schemaPluginId,
			mergeIdentityProperties: [],
			propertiesSchema: { fields: {} },
		},
	],
});

const runEnsureUserEntities = (options: {
	subject: SandboxExecutionSubject;
	caller: true | null;
	allowedHostFunctions?: readonly string[];
	pinnedEntitySchemaSlugs?: readonly string[];
}) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.ensureUserEntities(
					runInput(options.subject, options.allowedHostFunctions, {
						pluginRevision: options.caller
							? {
									...systemPluginRevision,
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

const runCreateUserEntity = (
	overrides: Partial<ScriptRunInput> = {},
	omitWorkflowIdentity = false,
) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) => {
			const input = {
				...runInput(
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: testAccountGeneration(UserId.make("trusted-user")),
					},
					["createUserEntity"],
					{
						pluginRevision: {
							...systemPluginRevision,
							schemaScope: {
								...systemPluginRevision.schemaScope,
								entitySchemaSlugs: ["workspace"],
							},
						},
					},
				),
				...overrides,
			};
			const { workflowExecutionId: _workflowExecutionId, ...withoutIdentity } = input;
			return functions.createUserEntity(omitWorkflowIdentity ? withoutIdentity : input, {
				name: "Another workspace",
				entitySchemaSlug: "workspace",
				properties: { key: "another" },
			});
		}),
	);

describe("createUserEntity", () => {
	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect(
			"uses the trusted user and durable command without bootstrap singleton semantics",
			() =>
				Effect.gen(function* () {
					expect(yield* runCreateUserEntity()).toEqual({ entityId: "created-id" });
					expect(yield* runCreateUserEntity({ hostCallDiscriminator: 1 })).toEqual({
						entityId: "created-id",
					});
					expect(yield* (yield* HostFunctionCalls).createdEntities).toMatchObject([
						{
							scope: "user",
							userId: "trusted-user",
							name: "Another workspace",
							properties: { key: "another" },
							entitySchema: {
								slug: "workspace",
								owner: { kind: "plugin", pluginId: systemPluginRevision.id },
							},
							lifecycle: {
								itemIdentity: "createUserEntity",
								causation: { lane: "interactive", executionId: "workflow-1-host-0" },
							},
						},
						{ lifecycle: { causation: { executionId: "workflow-1-host-1" } } },
					]);
					expect(yield* (yield* HostFunctionCalls).ensuredEntities).toEqual([]);
				}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect(
			"rejects undeclared, system, unpinned and foreign-schema writes before creating",
			() =>
				Effect.gen(function* () {
					const subject = {
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: testAccountGeneration(UserId.make("trusted-user")),
					} as const;
					const pinned = {
						...systemPluginRevision,
						schemaScope: { ...systemPluginRevision.schemaScope, entitySchemaSlugs: ["workspace"] },
					};
					for (const principal of [
						runInput(subject, [], { pluginRevision: pinned }).principal,
						runInput({ type: "system" }, ["createUserEntity"], { pluginRevision: pinned })
							.principal,
						runInput(subject, ["createUserEntity"]).principal,
						runInput(subject, ["createUserEntity"], { pluginRevision: systemPluginRevision })
							.principal,
					]) {
						const error = yield* Effect.flip(runCreateUserEntity({ principal }));
						expect(error.data).toEqual({
							code: "unavailable-operation",
							operation: "createUserEntity",
						});
					}
					yield* (yield* HostFunctionCalls).useDefinitions(workspaceDefinitions("foreign-plugin"));
					const error = yield* Effect.flip(runCreateUserEntity());
					expect(error.data).toEqual({
						code: "unavailable-operation",
						operation: "createUserEntity",
					});
					expect(yield* (yield* HostFunctionCalls).createdEntities).toEqual([]);
				}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("requires durable host-call identity before writing", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(runCreateUserEntity({}, true));
				expect(error.message).toBe("Lifecycle writes require a trusted durable host call");
				expect(yield* (yield* HostFunctionCalls).createdEntities).toEqual([]);
			}),
		);
	});
});

const runMergeUserEntityData = (
	overrides: Partial<ScriptRunInput> = {},
	item: { mergeFrom: string; mergeInto: string; entitySchemaSlug: string } = {
		mergeFrom: "from-1",
		mergeInto: "into-1",
		entitySchemaSlug: "workspace",
	},
) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) =>
			functions.mergeUserEntityData(
				{
					...runInput(
						{
							type: "user",
							userId: UserId.make("trusted-user"),
							accountGeneration: testAccountGeneration(UserId.make("trusted-user")),
						},
						["mergeUserEntityData"],
						{
							pluginRevision: {
								...systemPluginRevision,
								schemaScope: {
									...systemPluginRevision.schemaScope,
									entitySchemaSlugs: ["workspace"],
								},
							},
						},
					),
					...overrides,
				},
				item,
			),
		),
	);

describe("mergeUserEntityData", () => {
	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("merges under the sandbox principal as a kernel collection command", () =>
			Effect.gen(function* () {
				const functions = yield* makeAdditionalScriptHostFunctions;
				const input = runInput(
					{
						type: "user",
						userId: UserId.make("trusted-user"),
						accountGeneration: testAccountGeneration(UserId.make("trusted-user")),
					},
					["mergeUserEntityData"],
					{
						pluginRevision: {
							...systemPluginRevision,
							schemaScope: {
								...systemPluginRevision.schemaScope,
								entitySchemaSlugs: ["workspace"],
							},
						},
					},
				);
				expect(
					yield* functions.mergeUserEntityData(input, {
						mergeFrom: "from-1",
						mergeInto: "into-1",
						entitySchemaSlug: "workspace",
					}),
				).toEqual({ movedEventsCount: 2, movedRelationshipsCount: 3 });
				const [merge] = yield* (yield* HostFunctionCalls).userDataMerges;
				expect(merge).toMatchObject({
					userId: "trusted-user",
					command: { kernelCollection: true, itemIdentity: "mergeUserEntityData" },
					payload: { mergeFrom: "from-1", mergeInto: "into-1", entitySchemaSlug: "workspace" },
				});
				expect(merge?.command.writeContext).toBe(input.principal);
			}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("rejects undeclared, system, unpinned and foreign-schema merges", () =>
			Effect.gen(function* () {
				const subject = {
					type: "user",
					userId: UserId.make("trusted-user"),
					accountGeneration: testAccountGeneration(UserId.make("trusted-user")),
				} as const;
				const pinned = {
					...systemPluginRevision,
					schemaScope: { ...systemPluginRevision.schemaScope, entitySchemaSlugs: ["workspace"] },
				};
				for (const principal of [
					runInput(subject, [], { pluginRevision: pinned }).principal,
					runInput({ type: "system" }, ["mergeUserEntityData"], { pluginRevision: pinned })
						.principal,
				]) {
					const error = yield* Effect.flip(runMergeUserEntityData({ principal }));
					expect(error.data).toEqual({
						code: "unavailable-operation",
						operation: "mergeUserEntityData",
					});
				}
				const unpinned = yield* Effect.flip(
					runMergeUserEntityData({
						principal: runInput(subject, ["mergeUserEntityData"]).principal,
					}),
				);
				expect(unpinned).toEqual({ message: "Entity merge requires a pinned plugin" });
				for (const entitySchemaSlug of ["collection", "other"]) {
					const error = yield* Effect.flip(
						runMergeUserEntityData(
							{},
							{ entitySchemaSlug, mergeFrom: "from-1", mergeInto: "into-1" },
						),
					);
					expect(error.data).toEqual({
						code: "unavailable-operation",
						operation: "mergeUserEntityData",
					});
				}
				yield* (yield* HostFunctionCalls).useDefinitions(workspaceDefinitions("foreign-plugin"));
				const foreign = yield* Effect.flip(runMergeUserEntityData());
				expect(foreign.data).toEqual({
					code: "unavailable-operation",
					operation: "mergeUserEntityData",
				});
				expect(yield* (yield* HostFunctionCalls).userDataMerges).toEqual([]);
			}),
		);
	});
});

describe("ensureUserEntities", () => {
	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("binds the direct user and preserves first-create/idempotent results", () =>
			Effect.gen(function* () {
				const run = runEnsureUserEntities({
					caller: true,
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
						items: [
							{
								properties: {},
								name: "Workspace",
								entitySchema: {
									slug: "workspace",
									owner: { kind: "plugin", pluginId: systemPluginRevision.id },
								},
							},
						],
					},
					{
						userId: "trusted-user",
						items: [
							{
								properties: {},
								name: "Workspace",
								entitySchema: {
									slug: "workspace",
									owner: { kind: "plugin", pluginId: systemPluginRevision.id },
								},
							},
						],
					},
				]);
			}),
		);
	});

	layer(hostFunctionsLayer({ definitions: workspaceDefinitions() }))((test) => {
		test.effect("rejects delegated, system, untrusted, and foreign-schema executions", () =>
			Effect.gen(function* () {
				const trusted = true as const;
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
						accountGeneration: testAccountGeneration(UserId.make("user-1")),
					},
				});
				yield* (yield* HostFunctionCalls).useDefinitions(workspaceDefinitions("sample-plugin-id"));
				const foreign = yield* runEnsureUserEntities({
					caller: trusted,
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: testAccountGeneration(UserId.make("user-1")),
					},
				});

				for (const [result, message] of [
					[delegated, "available only to user executions"],
					[system, "not available for system executions"],
					[untrusted, "available only to pinned user bootstrap scripts"],
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
					caller: true,
					pinnedEntitySchemaSlugs: [],
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: testAccountGeneration(UserId.make("user-1")),
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
						accountGeneration: testAccountGeneration(UserId.make("owner-1")),
					},
				});

				const failure = Option.getOrThrow(Result.getFailure(declared));
				expect(failure.message).toContain("available only to pinned user bootstrap scripts");
				expect(failure.data).toEqual({
					code: "unavailable-operation",
					operation: "ensureUserEntities",
				});
			}),
		);
	});
});

describe("toSandboxCreateEventsResult", () => {
	it.effect(
		"preserves policy failures and earlier committed event IDs at the sandbox host boundary",
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.result(
					toSandboxCreateEventsResult({
						count: 1,
						warnings: [],
						outcomes: [{ index: 0, status: "written", eventId: EventId.make("committed-event") }],
						failure: {
							index: 1,
							reason: { code: "policy-execution-failed", runId: AutomationRunId.make("run-1") },
						},
					}),
				);

				expect(Result.getFailure(result)).toEqual(
					Option.some({
						message: "Event creation failed: policy-execution-failed",
						data: {
							count: 1,
							partial: true,
							code: "policy-execution-failed",
							outcomes: [{ index: 0, status: "written", eventId: "committed-event" }],
						},
					}),
				);
			}),
	);
});
