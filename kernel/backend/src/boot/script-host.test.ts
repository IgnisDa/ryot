import { describe, expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { PluginRyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	ImportRunId,
	IntegrationId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import { buildDefinitionSnapshot, type DefinitionSource } from "@ryot-app/definitions/snapshot";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { objectContaining, stringContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Option, Ref, Result } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
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
import { RyotQLService } from "#modules/ryotql/service";
import type { ScriptRunInput } from "#modules/scripts/authorization/capabilities";
import type {
	PluginSchemaScope,
	ScriptExecutionPrincipal,
} from "#modules/scripts/authorization/principal";
import {
	emptySchemaScope,
	emptyScriptsDigest,
} from "#modules/scripts/authorization/principal.test-support";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { entitlementsLayer } from "#platform/entitlements.test-support";
import { user } from "#schema/tables/auth";
import { makeAppConfigLayer, workflowEngineTestLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { makeAdditionalScriptHostFunctions } from "./script-host";

const userSettingsSchema = {
	unknownKeys: "strict",
	fields: {
		timezone: {
			type: "string",
			label: { key: "test.timezone" },
			description: "Timezone used by import normalization",
		},
	},
} as const;

const integrationRunExecutionSettings = (connectionId: string): ImportSourceExecutionSettings => ({
	userSettings: {},
	integration: {
		minimumProgress: 0,
		maximumProgress: 100,
		providerSpecifics: { account: connectionId },
	},
});

const seededDatabase = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{ id: "user-1", name: "User", email: "host-user@example.test" },
				{ name: "Trusted", id: "trusted-user", email: "trusted-host@example.test" },
				{ id: "owner-1", name: "Owner", email: "owner-host@example.test" },
			]),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("sandbox_host_functions")));

const hostDatabaseLayer = seededDatabase;

type GetForUserInput = { readonly userId: UserId; readonly integrationId: IntegrationId };

const ownedIntegration = (input: GetForUserInput): IntegrationRecord => ({
	name: null,
	lot: "yank",
	isDisabled: false,
	minimumProgress: 2,
	maximumProgress: 95,
	lastFinishedAt: null,
	userId: input.userId,
	provider: "lambda_yank",
	id: input.integrationId,
	sourceKey: "integration-source",
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
			subject.type === "automation-run" && subject.stage === "after"
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
		accountUserId: UserId.make("user-1"),
		executionUserId: UserId.make("user-1"),
		triggerId: AutomationTriggerId.make("trigger-1"),
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
			output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 10, maxLimit: 10 } },
		},
	},
} as const satisfies PluginRyotQLDocument;

const ryotqlResponse = {
	execution: { now: 0, timeZone: UTC, weekStart: 1 as const },
	data: {
		entities: {
			items: [],
			type: "rows" as const,
			pageInfo: { limit: 10, hasMore: false, nextCursor: null },
		},
	},
};

const systemPluginScope: PluginSchemaScope = {
	eventSchemas: [],
	signalSchemaSlugs: [],
	entitySchemaSlugs: ["example"],
	relationshipSchemaSlugs: ["example-monitoring"],
};

const systemPluginRevision = {
	ownerId: null,
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin-id"),
	scriptsDigest: emptyScriptsDigest,
	packageId: fixtureManifest().metadata.packageId,
	revisionId: PluginRevisionId.make("revision-1"),
	configRevisionId: PluginConfigRevisionId.make("config-1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
};
const workspacePluginRevision = {
	...systemPluginRevision,
	revisionId: PluginRevisionId.make("revision-workspace"),
};
const schemaScopesByRevisionId: Record<string, PluginSchemaScope> = {
	[systemPluginRevision.revisionId]: systemPluginScope,
	[workspacePluginRevision.revisionId]: { ...systemPluginScope, entitySchemaSlugs: ["workspace"] },
};

class HostFunctionCalls extends Context.Service<
	HostFunctionCalls,
	{
		readonly lookupOrder: Effect.Effect<ReadonlyArray<string>>;
		readonly ryotqlUserCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly ryotqlPluginCalls: Effect.Effect<ReadonlyArray<unknown>>;
		readonly sourceStateLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly oauthTokenRequests: Effect.Effect<ReadonlyArray<unknown>>;
		readonly pluginConfigLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly installationLookups: Effect.Effect<ReadonlyArray<unknown>>;
		readonly oauthTokenInvalidations: Effect.Effect<ReadonlyArray<unknown>>;
		readonly integrationLookups: Effect.Effect<ReadonlyArray<GetForUserInput>>;
	}
>()("@ryot-app/kernel-backend/boot/script-host.test/HostFunctionCalls") {}

const append = <A>(ref: Ref.Ref<ReadonlyArray<A>>, value: A) =>
	Ref.update(ref, (all) => [...all, value]);

const hostFunctionsLayer = (
	options: {
		readonly sourceStateRunId?: string;
		readonly definitions?: DefinitionSource;
		readonly sourceStateUnavailable?: boolean;
		readonly installationUnavailable?: boolean;
		readonly executionSettings?: (runId: string) => ImportSourceExecutionSettings;
		readonly pluginConfig?: PluginRuntimeResolver["Service"]["resolvePluginConfigContext"];
		readonly liveUserSettings?: Record<string, JsonValue> | (() => Record<string, JsonValue>);
		readonly integration?: (input: GetForUserInput) => Effect.Effect<null | IntegrationRecord>;
		readonly oauthAccessToken?: OAuthConnectionsService["Service"]["accessTokenForIntegrationRun"];
		readonly resolveWorkflowCallScript?: SandboxRepository["Service"]["resolveWorkflowCallScript"];
		readonly oauthAccessTokenInvalidation?: OAuthConnectionsService["Service"]["invalidateAccessTokenForIntegrationRun"];
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const ryotqlUserCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const ryotqlPluginCalls = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const pluginConfigLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const integrationLookups = yield* Ref.make<ReadonlyArray<GetForUserInput>>([]);
			const sourceStateLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const installationLookups = yield* Ref.make<ReadonlyArray<unknown>>([]);
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
				DefinitionCatalog.layer.pipe(Layer.provide(hostDatabaseLayer)),
				makeAppConfigLayer(),
				Layer.succeed(
					ManagedAssetsService,
					ManagedAssetsService.of({
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
				entitlementsLayer([]),
				Layer.mock(SandboxRepository)({
					resolveWorkflowCallScript:
						options.resolveWorkflowCallScript ?? (() => Effect.succeed(null)),
					getSchemaScope: (revisionId) =>
						Effect.succeed(schemaScopesByRevisionId[revisionId] ?? emptySchemaScope),
				}),
				Layer.succeed(HostFunctionCalls, {
					lookupOrder: Ref.get(lookupOrder),
					ryotqlUserCalls: Ref.get(ryotqlUserCalls),
					ryotqlPluginCalls: Ref.get(ryotqlPluginCalls),
					integrationLookups: Ref.get(integrationLookups),
					sourceStateLookups: Ref.get(sourceStateLookups),
					oauthTokenRequests: Ref.get(oauthTokenRequests),
					installationLookups: Ref.get(installationLookups),
					pluginConfigLookups: Ref.get(pluginConfigLookups),
					oauthTokenInvalidations: Ref.get(oauthTokenInvalidations),
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
					findPluginAvailableToUser: (_userId, pluginId) =>
						Effect.succeed({
							id: pluginId,
							isHidden: false,
							scope: "system",
							health: "ready",
							ownerUserId: null,
							clientImports: [],
							compiledHashes: {},
							contentHash: "content-hash",
							manifest: fixtureManifest(),
							pluginRevisionId: "revision-1",
							installationId: "installation-1",
							pluginConfigRevisionId: "config-1",
							packageId: fixtureManifest().metadata.packageId,
						}),
				}),
				Layer.mock(RyotQLService)({
					executeForPlugin: (scope, doc) =>
						append(ryotqlPluginCalls, { scope, document: doc }).pipe(Effect.as(ryotqlResponse)),
					executeForUser: (userId, language, audience, doc) =>
						append(ryotqlUserCalls, { userId, language, audience, document: doc }).pipe(
							Effect.as(ryotqlResponse),
						),
				}),
			);
			return dependencies;
		}),
	);

const runGetCurrentIntegration = (subject: SandboxExecutionSubject) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(functions.getCurrentIntegration(runInput(subject))),
		),
	);

describe("getUserPreferences", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"reads authoritative preferences and preserves missing-user failures",
			() =>
				Effect.gen(function* () {
					const auth = yield* AuthRepository;
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					yield* auth.patchUserPreferences(userId, { disableIntegrations: true });
					expect(yield* functions.getUserPreferences(runInput({ userId, type: "user" }))).toEqual({
						disableIntegrations: true,
					});
					expect(
						yield* Effect.flip(
							functions.getUserPreferences(
								runInput({ type: "user", userId: UserId.make("missing") }),
							),
						),
					).toEqual({ message: "User not found" });
				}),
			testTimeout,
		);

		test.effect(
			"reports malformed preferences through the host boundary",
			() =>
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
											runInput({ type: "user", userId: UserId.make("user-1") }),
										),
									).pipe(Effect.orDie),
								).toEqual({ message: "Invalid stored user preferences" });
								return yield* new DbError({ message: "roll back malformed preferences" });
							}),
						),
					);
					assertExitFails(exit, new DbError({ message: "roll back malformed preferences" }));
				}),
			testTimeout,
		);

		test.effect(
			"captures preference reads from a replacement constructor dependency",
			() =>
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
							runInput({ type: "user", userId: UserId.make("not-in-database") }),
						),
					).toEqual({ disableIntegrations: true });
				}),
			testTimeout,
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
	} satisfies SandboxExecutionSubject;

	layer(
		hostFunctionsLayer({
			executionSettings: () => integrationRunExecutionSettings("connection-1"),
			oauthAccessToken: () =>
				Effect.succeed({ accessToken: "access-1", expiresAt: "2026-01-01T01:00:00.000Z" }),
		}),
	)((test) => {
		test.effect(
			"forwards the trusted integration run scope to the connection owner",
			() =>
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
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"rejects executions that are not a running integration's plugin run",
			() =>
				Effect.gen(function* () {
					const cases = [
						{
							subject: {
								type: "user",
								userId: UserId.make("user-1"),
								integrationId: IntegrationId.make("int-trusted"),
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
			testTimeout,
		);
	});
});

describe("invalidateOAuthAccessToken", () => {
	const integrationRunSubject = {
		type: "user",
		userId: UserId.make("user-1"),
		integrationId: IntegrationId.make("int-trusted"),
		integrationRunId: ImportRunId.make("run-trusted"),
	} satisfies SandboxExecutionSubject;

	layer(
		hostFunctionsLayer({
			oauthAccessTokenInvalidation: () => Effect.succeed(null),
			executionSettings: () => integrationRunExecutionSettings("connection-1"),
		}),
	)((test) => {
		test.effect(
			"forwards the trusted integration run scope and supplied access token",
			() =>
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
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"rejects invalidation outside an integration's plugin run",
			() =>
				Effect.gen(function* () {
					const result = yield* runInvalidateOAuthAccessToken({
						type: "user",
						userId: UserId.make("user-1"),
					});
					const failure = Option.getOrThrow(Result.getFailure(result));

					expect(failure.message).toContain("available only");
					expect(failure.data).toEqual({
						code: "unavailable-operation",
						operation: "invalidateOAuthAccessToken",
					});
					expect(yield* (yield* HostFunctionCalls).oauthTokenInvalidations).toEqual([]);
				}),
			testTimeout,
		);
	});
});

describe("getCurrentIntegration", () => {
	layer(hostFunctionsLayer({ integration: (input) => Effect.succeed(ownedIntegration(input)) }))(
		(test) => {
			test.effect(
				"resolves the integration the operation execution was dispatched for",
				() =>
					Effect.gen(function* () {
						const result = yield* runGetCurrentIntegration({
							type: "user",
							userId: UserId.make("user-1"),
							integrationId: IntegrationId.make("int-trusted"),
						});

						expect(yield* (yield* HostFunctionCalls).integrationLookups).toEqual<unknown>([
							{ userId: "user-1", integrationId: "int-trusted" },
						]);
						const integration = Result.getOrThrow(result);
						expect(integration.id).toBe<unknown>("int-trusted");
						expect(integration).not.toHaveProperty("pluginSlug");
						expect(integration.providerSpecifics).toEqual({
							kind: "lambda_yank",
							token: "lambda-token",
							baseUrl: "https://lambda.example",
						});
					}),
				testTimeout,
			);
		},
	);

	layer(hostFunctionsLayer({ integration: (input) => Effect.succeed(ownedIntegration(input)) }))(
		(test) => {
			test.effect(
				"resolves the integration a subscription execution originated from",
				() =>
					Effect.gen(function* () {
						const result = yield* runGetCurrentIntegration(
							automationSubject({
								kind: "integration",
								integrationId: IntegrationId.make("int-origin"),
							}),
						);

						expect(yield* (yield* HostFunctionCalls).integrationLookups).toEqual<unknown>([
							{ userId: "user-1", integrationId: "int-origin" },
						]);
						expect(Result.getOrThrow(result).id).toBe<unknown>("int-origin");
					}),
				testTimeout,
			);
		},
	);

	layer(hostFunctionsLayer({ integration: () => Effect.die("must not reach the repository") }))(
		(test) => {
			test.effect(
				"fails when the execution has no integration in scope",
				() =>
					Effect.forEach(
						[
							{ type: "user", userId: UserId.make("user-1") },
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
				testTimeout,
			);
		},
	);

	layer(hostFunctionsLayer({ integration: () => Effect.succeed(null) }))((test) => {
		test.effect(
			"keeps the executing user's ownership scope",
			() =>
				Effect.gen(function* () {
					const result = yield* runGetCurrentIntegration({
						type: "user",
						userId: UserId.make("user-1"),
						integrationId: IntegrationId.make("int-of-another-user"),
					});

					expect(Result.getFailure(result)).toEqual(
						Option.some({ message: "Integration not found" }),
					);
				}),
			testTimeout,
		);
	});

	const selectedSettings = {
		minimumProgress: 10,
		maximumProgress: 80,
		providerSpecifics: { filter: "item", kind: "lambda_yank", provider: "provider" },
	};
	const changedSettings = {
		minimumProgress: 20,
		maximumProgress: 90,
		providerSpecifics: { filter: "show", provider: "tvdb", kind: "lambda_yank" },
	};
	let liveIntegrationSettings = {
		minimumProgress: 1,
		maximumProgress: 99,
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
								{ userId, type: "user", integrationId, integrationRunId: ImportRunId.make(runId) },
								SANDBOX_HOST_CAPABILITIES,
								{ pluginRevision: ingestionTestRevision },
							),
							executionId: `${runId}-import`,
						});
					const firstRead = yield* readForRun("run-1");
					liveIntegrationSettings = {
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
					expect(nextRun.providerSpecifics).toEqual({
						filter: "show",
						provider: "tvdb",
						kind: "lambda_yank",
					});
					expect(nextRun.minimumProgress).toBe(20);
					expect(nextRun.maximumProgress).toBe(90);
					expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toEqual(
						["run-1", "run-1", "run-2"].map((runId) => ({ runId, userId })),
					);
					expect(yield* (yield* HostFunctionCalls).lookupOrder).toEqual(
						Array.from({ length: 3 }, () => ["integration", "source-state"]).flat(),
					);
				}),
			testTimeout,
		);
	});
});

describe("getUserSettings", () => {
	layer(hostFunctionsLayer({ liveUserSettings: { timezone: "UTC" } }))((test) => {
		test.effect(
			"keeps non-ingestion settings live",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					expect(
						yield* functions.getUserSettings({
							...runInput({ userId, type: "user" }, ["getUserSettings"], {
								pluginRevision: systemPluginRevision,
							}),
							context: { runId: "run-1" },
							executionId: "run-1-import",
						}),
					).toEqual({ timezone: "UTC" });
				}),
			testTimeout,
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
		test.effect(
			"uses the accepted timezone for child and durable host executions",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					const readForRun = (
						runId: string,
						executionId: string,
						context: Record<string, unknown>,
					) =>
						functions.getUserSettings({
							...runInput(
								{ userId, type: "user", importRunId: ImportRunId.make(runId) },
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
					expect(
						yield* readForRun("run-1", "run-1-import-host-1", { runId: "forged-run" }),
					).toEqual({ timezone: "America/Los_Angeles" });
					expect(
						yield* readForRun("run-2", "run-2-import-child-collect-0", { runId: "run-1" }),
					).toEqual({ timezone: "Asia/Tokyo" });
					expect(yield* (yield* HostFunctionCalls).sourceStateLookups).toEqual(
						["run-1", "run-1", "run-2"].map((runId) => ({ runId, userId })),
					);
					expect(yield* (yield* HostFunctionCalls).installationLookups).toMatchObject(
						[0, 1, 2].map(() => ({ userId, pluginId: "plugin-1", pluginRevisionId: "revision-1" })),
					);
					expect(yield* (yield* HostFunctionCalls).lookupOrder).toEqual(
						Array.from({ length: 3 }, () => ["installation", "source-state"]).flat(),
					);
				}),
			testTimeout,
		);
	});
	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"rejects admitted settings from a different pinned plugin",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					const result = yield* Effect.result(
						functions.getUserSettings({
							...runInput(
								{ userId, type: "user", importRunId: ImportRunId.make("run-1") },
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
			testTimeout,
		);
	});
	layer(hostFunctionsLayer({ installationUnavailable: true }))((test) => {
		test.effect(
			"rejects admitted settings after the live installation is deleted",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					const result = yield* Effect.result(
						functions.getUserSettings({
							...runInput(
								{ userId, type: "user", importRunId: ImportRunId.make("run-1") },
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
			testTimeout,
		);
	});
	layer(
		hostFunctionsLayer({
			executionSettings: () => ({
				userSettings: { timezone: "x".repeat(SANDBOX_LIMITS.userSettingsBytes) },
			}),
		}),
	)((test) => {
		test.effect(
			"rejects settings larger than the sandbox bound",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const result = yield* Effect.result(
						functions.getUserSettings({
							...runInput(
								{
									type: "user",
									userId: UserId.make("user-1"),
									importRunId: ImportRunId.make("run-1"),
								},
								["getUserSettings"],
								{ pluginRevision: ingestionTestRevision },
							),
							executionId: "run-1-import-host-1",
						}),
					);
					expect(Option.getOrThrow(Result.getFailure(result)).message).toBe(
						`Plugin user settings exceed ${SANDBOX_LIMITS.userSettingsBytes} UTF-8 bytes`,
					);
				}),
			testTimeout,
		);
	});
	layer(hostFunctionsLayer({ sourceStateRunId: "run-1" }))((test) => {
		test.effect(
			"rejects a run ID that does not own the accepted settings snapshot",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					const result = yield* Effect.result(
						functions.getUserSettings({
							...runInput(
								{ userId, type: "user", importRunId: ImportRunId.make("different-run") },
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
						{ userId, runId: "different-run" },
					]);
				}),
			testTimeout,
		);
	});
	layer(hostFunctionsLayer({ sourceStateUnavailable: true }))((test) => {
		test.effect(
			"does not fall back to live settings for an admitted import",
			() =>
				Effect.gen(function* () {
					const functions = yield* makeAdditionalScriptHostFunctions;
					const userId = UserId.make("user-1");
					const result = yield* Effect.result(
						functions.getUserSettings({
							...runInput(
								{ userId, type: "user", importRunId: ImportRunId.make("run-1") },
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
			testTimeout,
		);
	});
});

const pluginConfigSchema = {
	unknownKeys: "strict",
	fields: {
		apiToken: {
			type: "string",
			label: { key: "test.api-token" },
			description: "Token used by the plugin",
		},
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

describe("getPluginConfig", () => {
	layer(hostFunctionsLayer({ pluginConfig: () => Effect.succeed({ apiToken: "pinned-value" }) }))(
		(test) => {
			test.effect(
				"resolves the exact pinned configuration revision",
				() =>
					Effect.gen(function* () {
						const result = yield* runGetPluginConfig({
							pluginRevision: { ...systemPluginRevision, configSchema: pluginConfigSchema },
						});

						expect(Result.getOrThrow(result)).toEqual({ apiToken: "pinned-value" });
						expect(yield* (yield* HostFunctionCalls).pluginConfigLookups).toEqual([
							{ id: "config-1", ownerUserId: null, pluginRevisionId: "revision-1" },
						]);
					}),
				testTimeout,
			);
		},
	);

	layer(hostFunctionsLayer({ pluginConfig: () => Effect.succeed({}) }))((test) => {
		test.effect(
			"returns a boundary reason for missing required configuration",
			() =>
				Effect.gen(function* () {
					const result = yield* runGetPluginConfig({
						pluginRevision: { ...systemPluginRevision, configSchema: pluginConfigSchema },
					});
					const failure = Option.getOrThrow(Result.getFailure(result));

					expect(failure.message).toContain("not configured");
					expect(failure.data).toEqual({ keys: ["apiToken"], code: "missing-required-config" });
				}),
			testTimeout,
		);
	});

	layer(hostFunctionsLayer({ pluginConfig: () => Effect.die("must not resolve unpinned config") }))(
		(test) => {
			test.effect(
				"rejects config access before resolving without a trusted pin",
				() =>
					Effect.gen(function* () {
						const result = yield* runGetPluginConfig({});

						const failure = Option.getOrThrow(Result.getFailure(result));
						expect(failure.message).toContain("active plugin scripts");
						expect(failure.data).toEqual({
							operation: "getPluginConfig",
							code: "unavailable-operation",
						});
					}),
				testTimeout,
			);
		},
	);

	layer(
		hostFunctionsLayer({
			pluginConfig: () =>
				Effect.fail(new DbError({ message: "Invalid pinned plugin configuration ownership" })),
		}),
	)((test) => {
		test.effect(
			"preserves the structured failure for an unavailable pinned configuration",
			() =>
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
			testTimeout,
		);
	});
});

const runExecuteRyotql = (input: ScriptRunInput, document: PluginRyotQLDocument = ryotqlDocument) =>
	makeAdditionalScriptHostFunctions.pipe(
		Effect.flatMap((functions) =>
			Effect.result(
				functions.executeRyotql(input, { source: { kind: "inline", document: document } }),
			),
		),
	);

describe("executeRyotql", () => {
	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"executes with the schema scope of the pinned revision",
			() =>
				Effect.gen(function* () {
					const result = yield* runExecuteRyotql({
						...runInput({ type: "system" }),
						principal: {
							...runInput({ type: "system" }).principal,
							pluginRevision: systemPluginRevision,
							metadata: { kind: "script", runtimeImports: [], capabilities: ["executeRyotql"] },
						},
					});

					const calls = yield* HostFunctionCalls;
					expect(Result.getOrThrow(result)).toEqual(ryotqlResponse);
					expect(yield* calls.ryotqlPluginCalls).toEqual([
						{
							document: { source: { kind: "inline", document: ryotqlDocument } },
							scope: {
								eventSchemas: [],
								signalSchemaSlugs: [],
								entitySchemaSlugs: ["example"],
								pluginId: systemPluginRevision.id,
								packageId: systemPluginRevision.packageId,
								relationshipSchemaSlugs: ["example-monitoring"],
								pluginRevisionId: systemPluginRevision.revisionId,
							},
						},
					]);
					expect(yield* calls.ryotqlUserCalls).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"stamps inline parameter text with the run's plugin namespace",
			() =>
				Effect.gen(function* () {
					const label = { key: "query-parameter.name" };
					const parameters = {
						fields: { name: { label, type: "string", description: "Name" } },
					} as const;
					yield* runExecuteRyotql(
						{
							...runInput({ type: "system" }),
							principal: {
								...runInput({ type: "system" }).principal,
								pluginRevision: systemPluginRevision,
								metadata: { kind: "script", runtimeImports: [], capabilities: ["executeRyotql"] },
							},
						},
						{ ...ryotqlDocument, parameters },
					);

					expect(yield* (yield* HostFunctionCalls).ryotqlPluginCalls).toMatchObject([
						{
							document: {
								source: {
									kind: "inline",
									document: {
										...ryotqlDocument,
										parameters: {
											fields: {
												name: {
													type: "string",
													description: "Name",
													label: { ...label, namespace: systemPluginRevision.id },
												},
											},
										},
									},
								},
							},
						},
					]);
				}),
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"keeps delegated execution in the user scope with the plugin audience",
			() =>
				Effect.gen(function* () {
					const result = yield* runExecuteRyotql(runInput(automationSubject({ kind: "api" })));

					const calls = yield* HostFunctionCalls;
					expect(Result.getOrThrow(result)).toEqual(ryotqlResponse);
					expect(yield* calls.ryotqlPluginCalls).toEqual([]);
					expect(yield* calls.ryotqlUserCalls).toEqual([
						{
							language: null,
							userId: "user-1",
							audience: "plugin",
							document: { source: { kind: "inline", document: ryotqlDocument } },
						},
					]);
				}),
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"rejects unpinned system execution",
			() =>
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
					expect(failure.data).toEqual({
						operation: "executeRyotql",
						code: "unavailable-operation",
					});
					expect(yield* (yield* HostFunctionCalls).ryotqlPluginCalls).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(hostFunctionsLayer())((test) => {
		test.effect(
			"rejects caller-supplied execution scope in the document",
			() =>
				Effect.gen(function* () {
					const callerSuppliedDocument = { ...ryotqlDocument, scope: "plugin" };
					const result = yield* runExecuteRyotql(
						runInput({ type: "user", userId: UserId.make("user-1") }),
						callerSuppliedDocument,
					);

					expect(Option.getOrThrow(Result.getFailure(result))).toEqual<unknown>(
						objectContaining({ message: stringContaining("scope") }),
					);
					expect(yield* (yield* HostFunctionCalls).ryotqlUserCalls).toEqual([]);
				}),
			testTimeout,
		);
	});
});
