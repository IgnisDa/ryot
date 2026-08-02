import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, FileSystem, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { ClientPagesRepository } from "#modules/client-pages/repository";
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
	definitionForPlugin,
	requirePluginKey,
	requireNotificationMetadataSchema,
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
		const error = yield* requireNotificationMetadataSchema(
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
			yield* requireNotificationMetadataSchema(
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

it.effect("resolves archive keys from persisted plugin IDs", () =>
	Effect.gen(function* () {
		const keys = new Map([
			["persisted-plugin", "user:persisted:source-hash"],
			["current-plugin", "user:current:source-hash"],
		]);
		expect(yield* requirePluginKey(keys, "persisted-plugin")).toBe("user:persisted:source-hash");
		assertExitFails(
			yield* Effect.exit(requirePluginKey(keys, "unavailable-plugin")),
			new BadRequest({ message: "Backup references unavailable plugin 'unavailable-plugin'" }),
		);
	}),
);

it("uses current definitions only when their owner matches persisted provenance", () => {
	const definition = { pluginId: "current-plugin", propertiesSchema: { fields: {} } };
	expect(definitionForPlugin(definition, "current-plugin")).toBe(definition);
	expect(definitionForPlugin(definition, "persisted-plugin")).toBeUndefined();
	expect(definitionForPlugin(undefined, "persisted-plugin")).toBeUndefined();
});

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
	isDisabled: false,
	healthReason: null,
	homeSavedViewId: null,
	health: "ready" as const,
	createdAt: new Date("2026-08-24T12:00:00.000Z"),
	updatedAt: new Date("2026-08-24T12:00:00.000Z"),
});

it.effect(
	"exports private records from their persisted package when effective ownership differs",
	() => {
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
			health: "incompatible" as const,
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
						fields: {
							title: { label: "Title", description: "Title", type: "string" as const },
							token: {
								secret: true as const,
								label: "Token",
								description: "Token",
								type: "string" as const,
							},
							relatedEntityId: {
								label: "Related entity",
								description: "Related entity",
								type: "string" as const,
								reference: { kind: "entity-id" as const },
							},
						},
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
		const differentOwnerManifest = {
			...privateManifest,
			entitySchemas: privateManifest.entitySchemas.map((definition) => ({
				...definition,
				propertiesSchema: {
					fields: { title: { label: "Title", description: "Title", type: "string" as const } },
				},
			})),
		};
		let effectiveDefinitionReads = 0;
		const effectiveDefinitions = buildDefinitionSnapshot(
			mergeManifestDefinitions(
				{ savedViews: [], entitySchemas: [], signalSchemas: [], relationshipSchemas: [] },
				[{ id: "different-plugin-id", slug: "private-plugin", manifest: differentOwnerManifest }],
			),
		);
		const privateTimestamp = new Date("2026-08-24T12:00:00.000Z");
		let embeddedDependencyIds: ReadonlyArray<string> = [];
		const layer = BackupExportSnapshot.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					databaseLayer,
					BunFileSystem.layer,
					Layer.mock(ClientPagesRepository, { listRenderers: () => Effect.succeed([]) }),
					Layer.mock(PluginRuntimeResolver, {
						getEffectiveDefinitions: (_userId, includeUnavailable) =>
							Effect.sync(() => {
								effectiveDefinitionReads += 1;
								expect(includeUnavailable).toBe(true);
								return effectiveDefinitions;
							}),
					}),
					Layer.mock(AuthRepository, {
						getPortableProfile: () =>
							Effect.succeed({ name: "Owner", image: null, preferences: {} }),
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
									extraSettings: { disableOnContinuousErrors: true },
									createdAt: new Date("2026-08-24T12:00:00.000Z"),
									updatedAt: new Date("2026-08-24T12:00:00.000Z"),
									providerSpecifics: {
										endpoint: "local",
										credentials: { token: "integration-secret" },
									},
								},
							]),
					}),
					Layer.mock(EntitiesRepository, {
						listUserEntitiesForBackup: () =>
							Effect.succeed([
								{
									origin: null,
									provider: null,
									externalId: null,
									populatedAt: null,
									id: "private-entity",
									name: "Private entity",
									entitySchemaSlug: "private-record",
									entitySchemaPluginId: "private-plugin-id",
									createdAt: new Date("2026-08-24T12:00:00.000Z"),
									updatedAt: new Date("2026-08-24T12:00:00.000Z"),
									properties: {
										token: "entity-secret",
										title: "Private title",
										relatedEntityId: "private-dependency",
									},
								},
							]),
						listGlobalEntitiesByIdsForBackup: (ids) =>
							Effect.sync(() => {
								embeddedDependencyIds = ids;
								return [
									{
										origin: null,
										provider: null,
										externalId: null,
										populatedAt: null,
										id: "private-dependency",
										name: "Private dependency",
										createdAt: privateTimestamp,
										updatedAt: privateTimestamp,
										entitySchemaSlug: "private-record",
										entitySchemaPluginId: "private-plugin-id",
										properties: { token: "dependency-secret", title: "Dependency" },
									},
								];
							}),
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
						listSourceFiles: () =>
							Effect.succeed({ "client/asset.png": new Uint8Array([0x00, 0xff, 0x80, 0x41]) }),
						listPrivateForUser: () =>
							Effect.succeed([
								{
									scripts: [],
									ownerId: userId,
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
									client: undefined,
									signalSchemaSlugs: [],
									slug: "default-plugin",
									id: "default-plugin-id",
									integrationProviders: [],
									relationshipSchemaSlugs: [],
									sourceHash: "b".repeat(64),
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
									client: undefined,
									slug: "system-plugin",
									signalSchemaSlugs: [],
									id: "system-plugin-id",
									integrationProviders: [],
									relationshipSchemaSlugs: [],
									sourceHash: "a".repeat(64),
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
			expect(embeddedDependencyIds).toEqual(["private-dependency"]);
			expect(prepared.records.installations.map(({ packageKey }) => packageKey)).toEqual([
				`system:system-plugin:${"a".repeat(64)}`,
				`user:private-plugin:${privateSourceHash}`,
			]);
			expect(prepared.records.privatePlugins).toEqual([
				expect.objectContaining({
					slug: "private-plugin",
					sourceHash: privateSourceHash,
					files: { "client/asset.png": "AP+AQQ==" },
					key: `user:private-plugin:${privateSourceHash}`,
				}),
			]);
			expect(prepared.records.entities).toEqual([
				expect.objectContaining({
					origin: null,
					id: "private-entity",
					entitySchemaPluginKey: `user:private-plugin:${privateSourceHash}`,
					properties: { title: "Private title", relatedEntityId: "private-dependency" },
				}),
			]);
			expect(prepared.records.entityDependencies).toEqual([
				expect.objectContaining({
					id: "private-dependency",
					properties: { title: "Dependency" },
					entitySchemaPluginKey: `user:private-plugin:${privateSourceHash}`,
				}),
			]);
			expect(prepared.records.entityDependencies[0]).not.toHaveProperty("origin");
			expect(prepared.redactions).toContain("/entities/private-entity/properties/token");
			expect(prepared.redactions).toContain(
				"/entity-dependencies/private-dependency/properties/token",
			);
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
	},
);

it.effect("reuses one export context across every event page", () => {
	const eventsPath = `${tmpdir()}/backup-export-events-${crypto.randomUUID()}.ndjson`;
	const timestamp = new Date("2026-08-24T12:00:00.000Z");
	const manifest = {
		...fixtureManifest(),
		crons: [],
		scripts: [],
		workflows: [],
		providers: [],
		operations: [],
		savedViews: [],
		signalSchemas: [],
		userBootstrap: [],
		relationshipSchemas: [],
		integrationProviders: [],
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		metadata: { ...fixtureManifest().metadata, slug: "private-plugin" },
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
		entitySchemas: [
			{
				icon: "box",
				name: "Private Record",
				slug: "private-record",
				propertiesSchema: { fields: {} },
				eventSchemas: [
					{
						name: "Watched",
						slug: "watched",
						propertiesSchema: {
							fields: {
								note: { type: "string" as const, label: "Note", description: "Note" },
								token: {
									label: "Token",
									description: "Token",
									secret: true as const,
									type: "string" as const,
								},
								poster: {
									properties: {},
									label: "Poster",
									description: "Poster",
									type: "object" as const,
									validation: { asset: true as const },
								},
							},
						},
					},
				],
			},
		],
	};
	const sourceHash = pluginSourceHash(manifest, {});
	const eventRow = (id: string, note: string) => ({
		id,
		note,
		createdAt: timestamp,
		updatedAt: timestamp,
		occurredAt: timestamp,
		sessionEntityId: null,
		entityId: "private-entity",
		eventSchemaSlug: "watched",
		eventSchemaPluginId: "private-plugin-id",
		properties: {
			note,
			token: "event-secret",
			poster: { type: "local", key: `permanent/${id}.bin` },
		},
	});
	let portableReads = 0;
	let privateReads = 0;
	let requestedAssetKeys: ReadonlyArray<string> = [];
	const eventPageRequests: (string | undefined)[] = [];
	const layer = BackupExportSnapshot.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				BunFileSystem.layer,
				Layer.mock(ClientPagesRepository, { listRenderers: () => Effect.succeed([]) }),
				Layer.mock(PluginRuntimeResolver, {
					getEffectiveDefinitions: () =>
						Effect.succeed(
							buildDefinitionSnapshot(
								mergeManifestDefinitions(
									{ savedViews: [], entitySchemas: [], signalSchemas: [], relationshipSchemas: [] },
									[{ id: "private-plugin-id", slug: "private-plugin", manifest }],
								),
							),
						),
				}),
				Layer.mock(AuthRepository, {
					getPortableProfile: () => Effect.succeed({ name: "Owner", image: null, preferences: {} }),
				}),
				Layer.mock(EventsRepository, {
					listUserEventsForBackup: ({ afterId }) =>
						Effect.sync(() => {
							eventPageRequests.push(afterId);
							if (afterId === undefined) {
								return [eventRow("event-1", "first")];
							}
							return afterId === "event-1" ? [eventRow("event-2", "second")] : [];
						}),
				}),
				Layer.mock(EntitiesRepository, {
					listReferencedGlobalEntitiesForBackup: () => Effect.succeed([]),
					listGlobalEntitiesByIdsForBackup: () => Effect.succeed([]),
					listUserEntitiesForBackup: () =>
						Effect.succeed([
							{
								origin: null,
								properties: {},
								provider: null,
								externalId: null,
								populatedAt: null,
								createdAt: timestamp,
								updatedAt: timestamp,
								id: "private-entity",
								name: "Private entity",
								entitySchemaSlug: "private-record",
								entitySchemaPluginId: "private-plugin-id",
							},
						]),
				}),
				Layer.mock(SavedViewsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(TranslationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(IntegrationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(RelationshipsRepository, {
					listUserRelationshipsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(AutomationsRepository, {
					listNotificationSubscriptionsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(ManagedAssetsService, {
					verifyManagedAssetOwnership: (ownerUserId, locators) =>
						Effect.sync(() => {
							requestedAssetKeys = locators.map(({ key }) => key);
							return locators.map((locator) => ({
								size: 1,
								ownerUserId,
								key: locator.key,
								createdAt: timestamp,
								provider: locator.type,
								contentType: "image/png",
								sha256: `sha-${locator.key}`,
							}));
						}),
				}),
				Layer.mock(PluginRepository, {
					listSourceFiles: () => Effect.succeed({}),
					listPortablePluginMetadata: () =>
						Effect.sync(() => {
							portableReads += 1;
							return [];
						}),
					listPrivateForUser: () =>
						Effect.sync(() => {
							privateReads += 1;
							return [
								{
									manifest,
									sourceHash,
									scripts: [],
									ownerId: userId,
									slug: "private-plugin",
									scope: "user" as const,
									id: "private-plugin-id",
									status: "active" as const,
								},
							];
						}),
				}),
				Layer.mock(PluginInstallationRepository, { listForUser: () => Effect.succeed([]) }),
			),
		),
	);
	return Effect.gen(function* () {
		const snapshot = yield* BackupExportSnapshot;
		const prepared = yield* snapshot.prepareExportSnapshot(userId, eventsPath);
		expect(portableReads).toBe(1);
		expect(privateReads).toBe(1);
		expect(eventPageRequests).toEqual([
			undefined,
			"event-1",
			"event-2",
			undefined,
			"event-1",
			"event-2",
		]);
		expect(requestedAssetKeys).toEqual(["permanent/event-1.bin", "permanent/event-2.bin"]);
		expect(prepared.events.count).toBe(2);
		expect(prepared.redactions).toEqual([
			"/events/event-1/properties/token",
			"/events/event-2/properties/token",
		]);
		const fs = yield* FileSystem.FileSystem;
		const written = (yield* fs.readFileString(eventsPath))
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(written.map(({ id }) => id)).toEqual(["event-1", "event-2"]);
		expect(written.map(({ properties }) => properties)).toEqual([
			{ note: "first", poster: { type: "local", key: "sha-permanent/event-1.bin" } },
			{ note: "second", poster: { type: "local", key: "sha-permanent/event-2.bin" } },
		]);
	}).pipe(Effect.provide(Layer.mergeAll(layer, databaseLayer, BunFileSystem.layer)));
});
