import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { type CurrentUserValue, defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import { pluginConfigEnvironmentKey } from "@ryot-app/contract/modules/plugins/plugin-config";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { LocalStorageService } from "#lib/infrastructure/local-storage";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { RedisService } from "#lib/infrastructure/redis";
import { S3Service } from "#lib/infrastructure/s3";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#lib/test-utils/effect";
import { LifecycleWriteGuard } from "#modules/auth/lifecycle-write-guard";
import { ImportsService } from "#modules/imports/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { IntegrationsService } from "#modules/integrations/service";
import { OAuthConnectionsServiceLive } from "#modules/oauth-connections/layer";
import { OAuthConnectionsService } from "#modules/oauth-connections/service";
import { PluginBackupRestore } from "#modules/plugins/backup-restore";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { PluginBackupRestoreLive } from "#modules/plugins/layer";
import {
	installRevisionPackage,
	oauthRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";

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
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
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

const infrastructure = Layer.mergeAll(
	LifecycleWriteGuard.layer,
	S3Service.layer,
	LocalStorageService.layer,
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
				OAuthConnectionsServiceLive,
				Layer.mock(ImportsService)({}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(ProKeyService)({ isValidated: Effect.succeed(true) }),
			),
		),
	),
	OAuthConnectionsServiceLive,
).pipe(
	Layer.provide(tokenEndpointLayer),
	Layer.provideMerge(infrastructure),
	Layer.provideMerge(revisionDatabaseLayer),
);

const archiveText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

layer(roundTripLayer)((test) => {
	test.effect(
		"exports OAuth-backed integrations without connections and restores them disabled",
		() =>
			Effect.gen(function* () {
				yield* installRevisionPackage(
					oauthRevisionPackage("oauth-backup", "oauth-backup-yank"),
				).pipe(
					Effect.provideService(
						ConfigProvider.ConfigProvider,
						ConfigProvider.fromUnknown({
							[pluginConfigEnvironmentKey("oauth-backup", "clientId")]: "client-1",
							[pluginConfigEnvironmentKey("oauth-backup", "clientSecret")]: "client-secret-1",
						}),
					),
				);
				const session = yield* DatabaseSession;
				const connections = yield* OAuthConnectionsService;
				const { connectionId, authorizeUrl } = yield* connections.create(currentUser, {
					field: "account",
					client: { kind: "web" },
					integrationProvider: "oauth-backup-yank",
				});
				const state = new URL(authorizeUrl).searchParams.get("state");
				assert(state);
				const location = yield* connections.callback(
					{ pluginSlug: "oauth-backup", oauthProviderSlug: "account" },
					{ state, code: "backup-auth-code" },
				);
				const secret = new URLSearchParams(location.split("#")[1] ?? "").get("secret");
				assert(secret);
				yield* connections.complete(currentUser, connectionId, secret);
				const { id: integrationId } = yield* (yield* IntegrationsService).create(currentUser, {
					provider: "oauth-backup-yank",
					providerSpecifics: { account: connectionId, endpoint: "https://tracker.example.test" },
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

				const restored = yield* (yield* IntegrationsRepository).getForUser({
					integrationId,
					userId: owner,
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
