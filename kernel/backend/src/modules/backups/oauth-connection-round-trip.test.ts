import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	IntegrationId,
	PluginId,
	pluginPackageSegments,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { defaultUserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { and, eq } from "drizzle-orm";
import { ConfigProvider, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecycleWriteGuard } from "#modules/accounts/auth/lifecycle-write-guard";
import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { DataImportAdmission } from "#modules/imports/data-admission";
import { ImportsRepository } from "#modules/imports/repository";
import { ImportsService } from "#modules/imports/service";
import { integrationCrudIngestionLayer } from "#modules/integrations/crud.test-support";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { IntegrationProviderCatalog } from "#modules/plugins/catalog/integration-providers";
import { IngestionReadinessService } from "#modules/plugins/catalog/readiness-service";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginBackupRestoreLive } from "#modules/plugins/layer";
import { PluginBackupRestore } from "#modules/plugins/packages/backup-restore";
import { ingestionRetirementTestLayer } from "#modules/plugins/packages/ingestion-retirement.test-support";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import { SystemPlugins } from "#modules/plugins/packages/system";
import { DatabaseSession } from "#platform/db/session";
import { ProKeyService } from "#platform/pro-key";
import { RedisService } from "#platform/redis";
import { HmacSigner } from "#platform/storage/hmac-signer";
import { LocalStorageService } from "#platform/storage/local-storage";
import { S3Service } from "#platform/storage/s3";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupExportSnapshotLive, BackupRestoreWriterLive } from "./layer";
import { BackupRestoreWriter } from "./restore/writer";

const owner = UserId.make("owner");
const localTempDir = `/tmp/ryot-backup-oauth-round-trip-${crypto.randomUUID()}`;

const currentUser: CurrentUserValue = {
	id: owner,
	image: null,
	name: "Owner",
	email: "owner@example.test",
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: owner, token: "test-account-generation" },
};

const tokenEndpointLayer = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request) =>
		Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				Response.json({
					expires_in: 3600,
					token_type: "Bearer",
					access_token: "backup-access-token",
					refresh_token: "backup-refresh-token",
				}),
			),
		),
	),
);

const configLayer = makeAppConfigLayer({ fileStorage: { localTempDir } });

const mockProKey = (isValidated: boolean) =>
	Layer.mock(ProKeyService)({ isValidated: Effect.succeed(isValidated) });

const infrastructure = Layer.mergeAll(
	LifecycleWriteGuard.layer,
	S3Service.layer,
	LocalStorageService.layer.pipe(Layer.provideMerge(HmacSigner.layer)),
	Layer.succeed(RedisService, makeRedisService()),
).pipe(Layer.provideMerge(Layer.merge(configLayer, BunServices.layer)));

const roundTripLayer = Layer.mergeAll(
	BackupExportSnapshotLive,
	BackupRestoreWriterLive,
	PluginBackupRestoreLive,
	IntegrationsRepository.layer,
	IntegrationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				IntegrationsRepository.layer,
				IntegrationProviderCatalog.layer,
				IngestionReadinessService.layer,
				ImportsRepository.layer,
				integrationCrudIngestionLayer.pipe(
					Layer.provideMerge(ingestionRetirementTestLayer),
					Layer.provide(ObjectStorageService.layer),
					Layer.provide(Layer.succeed(AdmittedWorkflowCatalogue, Object.freeze([]))),
					Layer.provide(Layer.succeed(WorkflowEngine, makeWorkflowEngine())),
				),
				OAuthConnectionsServiceLive.pipe(Layer.provide(mockProKey(true))),
				Layer.mock(ImportsService)({}),
				Layer.mock(DataImportAdmission)({}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				mockProKey(true),
			),
		),
	),
	OAuthConnectionsServiceLive.pipe(Layer.provide(mockProKey(true))),
).pipe(
	Layer.provide(tokenEndpointLayer),
	Layer.provideMerge(infrastructure),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provide(
		Layer.succeed(SystemPlugins, { sources: [], packageIds: new Set<PluginPackageId>() }),
	),
);

const archiveText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer(roundTripLayer)((test) => {
	test.effect(
		"exports OAuth-backed integrations without connections and restores them disabled",
		() =>
			Effect.gen(function* () {
				const packageValue = oauthRevisionPackage("oauth-backup", "oauth-backup-yank");
				const { pluginId } = yield* installRevisionPackage(packageValue).pipe(
					Effect.provideService(
						ConfigProvider.ConfigProvider,
						ConfigProvider.fromUnknown({
							[pluginConfigEnvironmentKey(packageValue.manifest.metadata.packageId, "clientId")]:
								"client-1",
							[pluginConfigEnvironmentKey(
								packageValue.manifest.metadata.packageId,
								"clientSecret",
							)]: "client-secret-1",
						}),
					),
				);
				const session = yield* DatabaseSession;
				const connections = yield* OAuthConnectionsService;
				const { connectionId, authorizeUrl } = yield* connections.create(currentUser, {
					field: "account",
					client: { kind: "web" },
					integrationProvider: {
						slug: "oauth-backup-yank",
						owner: { kind: "plugin", pluginId: PluginId.make(pluginId) },
					},
				});
				const state = new URL(authorizeUrl).searchParams.get("state");
				assert(state);
				const location = yield* connections.callback(
					{
						...pluginPackageSegments(packageValue.manifest.metadata.packageId),
						oauthProviderSlug: "account",
					},
					{ state, code: "backup-auth-code" },
				);
				const secret = new URLSearchParams(location.split("#")[1] ?? "").get("secret");
				assert(secret);
				yield* connections.complete(currentUser, connectionId, secret);
				const { id: integrationId } = yield* (yield* IntegrationsService).create(currentUser, {
					providerSpecifics: { account: connectionId, endpoint: "https://tracker.example.test" },
					provider: {
						slug: "oauth-backup-yank",
						owner: { kind: "plugin", pluginId: PluginId.make(pluginId) },
					},
				});
				const [bound] = yield* session.run((db) =>
					db
						.select()
						.from(tables.oauthConnection)
						.where(eq(tables.oauthConnection.id, connectionId)),
				);
				expect(bound).toMatchObject({ integrationId, status: "connected" });

				const fs = yield* FileSystem.FileSystem;
				yield* fs.makeDirectory(localTempDir, { recursive: true });
				const directory = yield* fs.makeTempDirectoryScoped({ directory: localTempDir });
				const eventsPath = `${directory}/events.ndjson`;
				const snapshot = yield* session.transaction(
					(yield* BackupExportSnapshot).prepareExportSnapshot(owner, eventsPath),
				);
				const archive = yield* Stream.runCollect(
					createArchiveStream({
						assets: [],
						appVersion: "backend-v1",
						records: snapshot.records,
						archiveId: "oauth-round-trip",
						redactions: snapshot.redactions,
						createdAt: "2026-10-01T00:00:00.000Z",
						requiredPlugins: snapshot.requiredPlugins,
						events: {
							count: snapshot.events.count,
							bytes: snapshot.events.bytes,
							sha256: snapshot.events.sha256,
							chunks: Stream.toAsyncIterable(fs.stream(snapshot.events.path)),
						},
					}),
				);
				const validated = yield* validateArchiveStream(Stream.fromIterable(archive), {
					directory: localTempDir,
				});
				const [exportedIntegration] = validated.records.integrations;
				expect(validated.records.integrations).toHaveLength(1);
				expect(exportedIntegration).toMatchObject({
					id: integrationId,
					isDisabled: false,
					configuredSecretPaths: ["/account"],
					providerSpecifics: { endpoint: "https://tracker.example.test" },
				});
				expect(exportedIntegration?.providerSpecifics).not.toHaveProperty("account");
				expect(validated.manifest.redactions).toContain(
					`/integrations/${integrationId}/providerSpecifics/account`,
				);
				expect(
					archiveText({ records: validated.records, manifest: validated.manifest }),
				).not.toMatch(
					new RegExp(
						`${connectionId}|${secret}|backup-access-token|backup-refresh-token|backup-auth-code|client-secret-1`,
					),
				);

				yield* session.run((db) => db.delete(tables.user).where(eq(tables.user.id, owner)));
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: owner,
							name: "Owner",
							email: "owner@example.test",
							preferences: { ...defaultUserPreferences },
						}),
				);
				const installations = yield* PluginInstallationRepository;
				yield* installations.provisionSystemInstallationsForUser(owner);
				const existingInstallation = yield* installations.findByUserAndPlugin(owner, pluginId);
				assert(existingInstallation);
				expect(existingInstallation).toMatchObject({
					config: {},
					sortOrder: 0,
					health: "ready",
					isHidden: false,
					homeSavedView: null,
				});
				const writer = yield* BackupRestoreWriter;
				const pluginRestore = yield* PluginBackupRestore;
				const pluginIdByKey = yield* writer.assertRequiredPlugins(
					validated.manifest.requiredPlugins,
				);
				const definitions = yield* pluginRestore.buildDefinitions([], pluginIdByKey);
				yield* session.transaction(
					writer.restoreRecords(
						owner,
						validated.records,
						new Map(),
						validated.events,
						pluginIdByKey,
						definitions,
					),
				);

				const [restoredInstallation] = yield* session.run((db) =>
					db
						.select({ id: tables.pluginInstallation.id })
						.from(tables.pluginInstallation)
						.where(
							and(
								eq(tables.pluginInstallation.userId, owner),
								eq(tables.pluginInstallation.pluginId, pluginId),
							),
						),
				);
				assert(restoredInstallation);
				expect(restoredInstallation.id).toBe(existingInstallation.id);
				const restoredIntegrations = yield* session.run((db) =>
					db
						.select({ id: tables.integration.id })
						.from(tables.integration)
						.where(
							and(
								eq(tables.integration.userId, owner),
								eq(tables.integration.pluginInstallationId, restoredInstallation.id),
								eq(tables.integration.provider, "oauth-backup-yank"),
							),
						),
				);
				expect(restoredIntegrations).toHaveLength(1);
				const [restoredIntegration] = restoredIntegrations;
				assert(restoredIntegration);
				expect(restoredIntegration.id).not.toBe(integrationId);
				const restored = yield* (yield* IntegrationsRepository).getForUser({
					userId: owner,
					integrationId: IntegrationId.make(restoredIntegration.id),
				});
				expect(restored).toMatchObject({
					isDisabled: true,
					providerSpecifics: { endpoint: "https://tracker.example.test" },
				});
				expect(restored?.providerSpecifics).not.toHaveProperty("account");
				expect(yield* session.run((db) => db.select().from(tables.oauthConnection))).toEqual([]);
			}).pipe(Effect.scoped),
	);
});
