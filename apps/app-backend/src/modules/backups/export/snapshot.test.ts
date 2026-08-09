import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect, Layer } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { buildDefinitionSnapshot } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { mergeManifestDefinitions } from "#modules/plugins/loader";
import { pluginSourceHash } from "#modules/plugins/pipeline";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import {
	BackupExportSnapshot,
	collectManagedAssetLocators,
	requireV2NotificationMetadataSchema,
} from "./snapshot";

it("does not archive managed assets stored in schema-declared secret fields", () => {
	const propertiesSchema: AppSchema = {
		fields: {
			publicAsset: {
				type: "object",
				properties: {},
				label: "Public asset",
				description: "Public asset",
				validation: { asset: true },
			},
			secretAsset: {
				secret: true,
				type: "object",
				properties: {},
				label: "Secret asset",
				validation: { asset: true },
				description: "Secret asset",
			},
		},
	};
	expect(
		collectManagedAssetLocators([
			{
				propertiesSchema,
				properties: {
					publicAsset: { type: "local", key: "permanent/public.bin" },
					secretAsset: { type: "local", key: "permanent/secret.bin" },
				},
			},
		]),
	).toEqual([{ type: "local", key: "permanent/public.bin" }]);
});

it.effect("rejects non-null notification metadata without its signal schema", () =>
	Effect.gen(function* () {
		const error = yield* requireV2NotificationMetadataSchema(
			{
				isActive: false,
				signalSchemaPluginKey: null,
				metadata: { token: "secret" },
				signalSchemaSlug: "missing.signal",
			},
			undefined,
		).pipe(Effect.flip);
		expect(error.message).toContain("unavailable signal schema 'missing.signal'");
		expect(
			yield* requireV2NotificationMetadataSchema(
				{
					metadata: null,
					isActive: false,
					signalSchemaPluginKey: null,
					signalSchemaSlug: "missing.signal",
				},
				undefined,
			),
		).toBeUndefined();
	}),
);

const userId = UserId.make("user-1");

const installationRow = (input: {
	readonly id: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly pluginScope: "system" | "user";
}) => ({
	...input,
	userId,
	config: {},
	sortOrder: 0,
	health: "ready" as const,
	isDisabled: false,
	healthReason: null,
	createdAt: new Date("2026-08-24T12:00:00.000Z"),
	updatedAt: new Date("2026-08-24T12:00:00.000Z"),
});

it.effect("exports active installation state and secret-safe private packages", () => {
	const eventsPath = `${tmpdir()}/backup-export-installations-${crypto.randomUUID()}.ndjson`;
	const systemInstallation = installationRow({
		pluginScope: "system",
		id: "installation-system",
		pluginSlug: "system-plugin",
		pluginId: "system-plugin-id",
	});
	const configuredSystemInstallation = {
		...systemInstallation,
		config: { locale: "source-only", token: "source-system-secret" },
	};
	const unavailableSystemInstallation = installationRow({
		pluginScope: "system",
		id: "installation-unavailable",
		pluginSlug: "unavailable-plugin",
		pluginId: "unavailable-plugin-id",
	});
	const defaultSystemInstallation = installationRow({
		pluginScope: "system",
		id: "installation-default",
		pluginSlug: "default-plugin",
		pluginId: "default-plugin-id",
	});
	const privateInstallation = {
		...installationRow({
			pluginScope: "user",
			id: "installation-private",
			pluginSlug: "private-plugin",
			pluginId: "private-plugin-id",
		}),
		config: {
			unit: "minutes",
			credentials: { token: "secret", region: "local" },
			accounts: [{ token: "array-secret", label: "primary" }],
		},
	};
	const privateManifest = {
		...fixtureManifest(),
		crons: [],
		scripts: [],
		workflows: [],
		providers: [],
		operations: [],
		savedViews: [],
		entitySchemas: [
			{
				icon: "box",
				name: "Private Record",
				slug: "private-record",
				eventSchemas: [],
				propertiesSchema: {
					fields: { title: { label: "Title", description: "Title", type: "string" as const } },
				},
			},
		],
		signalSchemas: [],
		userBootstrap: [],
		relationshipSchemas: [],
		metadata: { ...fixtureManifest().metadata, slug: "private-plugin" },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
		configSchema: {
			unknownKeys: "strict" as const,
			fields: {
				accounts: {
					label: "Accounts",
					type: "array" as const,
					description: "Accounts",
					items: {
						label: "Account",
						description: "Account",
						type: "object" as const,
						properties: {
							label: { type: "string" as const, label: "Label", description: "Label" },
							token: {
								label: "Token",
								description: "Token",
								secret: true as const,
								type: "string" as const,
								validation: { required: true as const },
							},
						},
					},
				},
				credentials: {
					label: "Credentials",
					type: "object" as const,
					description: "Credentials",
					properties: {
						region: { type: "string" as const, label: "Region", description: "Region" },
						token: {
							label: "Token",
							description: "Token",
							secret: true as const,
							type: "string" as const,
							validation: { required: true as const },
						},
					},
				},
				unit: { label: "Unit", validation: {}, description: "Unit", type: "string" as const },
			},
		},
		integrationProviders: [
			{
				lot: "push" as const,
				slug: "private-push",
				name: "Private Push",
				description: "Private push integration",
				settingsSchema: {
					unknownKeys: "strict" as const,
					fields: {
						credentials: {
							label: "Credentials",
							type: "object" as const,
							description: "Credentials",
							properties: {
								token: {
									label: "Token",
									description: "Token",
									secret: true as const,
									type: "string" as const,
									validation: { required: true as const },
								},
							},
						},
						endpoint: {
							validation: {},
							label: "Endpoint",
							description: "Endpoint",
							type: "string" as const,
						},
					},
				},
			},
		],
	};
	const privateSourceHash = pluginSourceHash(privateManifest, {});
	let effectiveDefinitionReads = 0;
	const effectiveDefinitions = buildDefinitionSnapshot(
		mergeManifestDefinitions(
			{ savedViews: [], entitySchemas: [], signalSchemas: [], relationshipSchemas: [] },
			[{ id: "private-plugin-id", slug: "private-plugin", manifest: privateManifest }],
		),
	);
	const layer = BackupExportSnapshot.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				BunFileSystem.layer,
				Layer.mock(PluginRuntimeResolver, {
					getEffectiveDefinitions: (_userId, includeUnavailable) =>
						Effect.sync(() => {
							effectiveDefinitionReads += 1;
							expect(includeUnavailable).toBe(true);
							return effectiveDefinitions;
						}),
				}),
				Layer.mock(AuthRepository, {
					getPortableProfile: () => Effect.succeed({ name: "Owner", image: null, preferences: {} }),
				}),
				Layer.mock(EventsRepository, { listUserEventsForBackup: () => Effect.succeed([]) }),
				Layer.mock(IntegrationsRepository, {
					listForBackup: () =>
						Effect.succeed([
							{
								userId,
								isDisabled: false,
								id: "integration-1",
								name: "Private push",
								lot: "push" as const,
								syncOwnership: false,
								minimumProgress: "2",
								lastFinishedAt: null,
								maximumProgress: "95",
								provider: "private-push",
								pluginSlug: "private-plugin",
								pluginInstallationId: "installation-private",
								createdAt: new Date("2026-08-24T12:00:00.000Z"),
								updatedAt: new Date("2026-08-24T12:00:00.000Z"),
								extraSettings: { disableOnContinuousErrors: true },
								providerSpecifics: {
									endpoint: "local",
									credentials: { token: "integration-secret" },
								},
							},
						]),
				}),
				Layer.mock(EntitiesRepository, {
					getByIdsForUser: () => Effect.succeed([]),
					listUserEntitiesForBackup: () =>
						Effect.succeed([
							{
								provider: null,
								externalId: null,
								populatedAt: null,
								id: "private-entity",
								name: "Private entity",
								properties: { title: "Private title" },
								entitySchemaSlug: "private-record",
								entitySchemaPluginId: "private-plugin-id",
								createdAt: new Date("2026-08-24T12:00:00.000Z"),
								updatedAt: new Date("2026-08-24T12:00:00.000Z"),
							},
						]),
					listGlobalEntitiesByIdsForBackup: () => Effect.succeed([]),
					listReferencedGlobalEntitiesForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(SavedViewsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(TranslationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(RelationshipsRepository, {
					listUserRelationshipsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(AutomationsRepository, {
					listNotificationSubscriptionsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(ManagedAssetsService, {
					verifyManagedAssetOwnership: () => Effect.succeed([]),
				}),
				Layer.mock(PluginRepository, {
					listPrivateForUser: () =>
						Effect.succeed([
							{
								scripts: [],
								ownerId: userId,
								sourceFiles: {},
								slug: "private-plugin",
								scope: "user" as const,
								id: "private-plugin-id",
								status: "active" as const,
								manifest: privateManifest,
								sourceHash: privateSourceHash,
							},
						]),
					listPortablePluginMetadata: () =>
						Effect.succeed([
							{
								version: "1.0.0",
								signalSchemaSlugs: [],
								slug: "default-plugin",
								id: "default-plugin-id",
								integrationProviders: [],
								sourceHash: "b".repeat(64),
								relationshipSchemaSlugs: [],
								configSchema: { fields: {}, unknownKeys: "strict" as const },
								metadata: {
									icon: "box",
									version: "1.0.0",
									name: "Default Plugin",
									slug: "default-plugin",
									description: "Default plugin",
								},
							},
							{
								version: "1.0.0",
								slug: "system-plugin",
								signalSchemaSlugs: [],
								id: "system-plugin-id",
								integrationProviders: [],
								sourceHash: "a".repeat(64),
								relationshipSchemaSlugs: [],
								metadata: {
									icon: "box",
									version: "1.0.0",
									name: "System Plugin",
									slug: "system-plugin",
									description: "System plugin",
								},
								configSchema: {
									unknownKeys: "strict" as const,
									fields: {
										locale: {
											validation: {},
											label: "Locale",
											description: "Locale",
											type: "string" as const,
										},
									},
									token: {
										label: "Token",
										description: "Token",
										secret: true as const,
										type: "string" as const,
										validation: { required: true as const },
									},
								},
							},
						]),
				}),
				Layer.mock(PluginInstallationRepository, {
					listSystemForUser: () => Effect.succeed([configuredSystemInstallation]),
					listForUser: () =>
						Effect.succeed([
							configuredSystemInstallation,
							defaultSystemInstallation,
							unavailableSystemInstallation,
							privateInstallation,
						]),
				}),
			),
		),
	);
	return Effect.gen(function* () {
		const snapshot = yield* BackupExportSnapshot;
		const prepared = yield* snapshot.prepareExportSnapshot(userId, eventsPath);
		expect(effectiveDefinitionReads).toBe(1);
		expect(prepared.records.installations.map(({ packageKey }) => packageKey)).toEqual([
			`system:system-plugin:${"a".repeat(64)}`,
			`user:private-plugin:${privateSourceHash}`,
		]);
		expect(prepared.records.privatePlugins).toEqual([
			expect.objectContaining({ files: {}, slug: "private-plugin", sourceHash: privateSourceHash }),
		]);
		expect(prepared.records.entities).toEqual([
			expect.objectContaining({
				id: "private-entity",
				properties: { title: "Private title" },
				entitySchemaPluginKey: `user:private-plugin:${privateSourceHash}`,
			}),
		]);
		expect(prepared.records.installations[0]).toMatchObject({
			config: {},
			configuredSecretPaths: [],
		});
		expect(prepared.records.installations[1]?.config).toEqual({
			unit: "minutes",
			accounts: [{ label: "primary" }],
			credentials: { region: "local" },
		});
		expect(prepared.records.installations[1]?.configuredSecretPaths).toEqual([
			"/accounts/0/token",
			"/credentials/token",
		]);
		expect(prepared.records.integrations).toEqual([
			expect.objectContaining({
				configuredSecretPaths: ["/credentials/token"],
				packageKey: `user:private-plugin:${privateSourceHash}`,
				providerSpecifics: { endpoint: "local", credentials: {} },
			}),
		]);
		expect(prepared.redactions.some((path) => path.includes("installation-system"))).toBe(false);
		expect(prepared.requiredPlugins).toEqual([
			{ slug: "system-plugin", sourceHash: "a".repeat(64), version: "1.0.0" },
		]);
	}).pipe(Effect.provide(Layer.mergeAll(layer, databaseLayer)));
});
