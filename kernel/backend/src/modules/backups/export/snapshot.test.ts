import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, it, layer } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import {
	NotificationSubscriptionId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, FileSystem, Layer, Ref } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { buildDefinitionSnapshot } from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { pluginSourceHash } from "#modules/plugins/pipeline";
import { PluginRepository } from "#modules/plugins/repository";
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
	isHidden: false,
	healthReason: null,
	uninstalledAt: null,
	homeSavedViewSlug: null,
	health: "ready" as const,
	activeConfigRevisionId: null,
	createdAt: new Date("2026-08-24T12:00:00.000Z"),
	updatedAt: new Date("2026-08-24T12:00:00.000Z"),
});

class FakeExportReads extends Context.Service<
	FakeExportReads,
	{
		readonly privateReads: Effect.Effect<number>;
		readonly portableReads: Effect.Effect<number>;
		readonly definitionReads: Effect.Effect<number>;
		readonly requestedAssetKeys: Effect.Effect<ReadonlyArray<string>>;
		readonly embeddedDependencyIds: Effect.Effect<ReadonlyArray<string>>;
		readonly eventPageRequests: Effect.Effect<ReadonlyArray<string | undefined>>;
	}
>()("test/FakeExportReads") {}

const makeExportReads = Effect.gen(function* () {
	const privateReads = yield* Ref.make(0);
	const portableReads = yield* Ref.make(0);
	const definitionReads = yield* Ref.make(0);
	const requestedAssetKeys = yield* Ref.make<ReadonlyArray<string>>([]);
	const embeddedDependencyIds = yield* Ref.make<ReadonlyArray<string>>([]);
	const eventPageRequests = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
	return {
		privateReads,
		portableReads,
		definitionReads,
		eventPageRequests,
		requestedAssetKeys,
		embeddedDependencyIds,
		service: FakeExportReads.of({
			privateReads: Ref.get(privateReads),
			portableReads: Ref.get(portableReads),
			definitionReads: Ref.get(definitionReads),
			eventPageRequests: Ref.get(eventPageRequests),
			requestedAssetKeys: Ref.get(requestedAssetKeys),
			embeddedDependencyIds: Ref.get(embeddedDependencyIds),
		}),
	};
});

const withExportReads = <A, E, R>(
	build: (reads: Effect.Success<typeof makeExportReads>) => Layer.Layer<A, E, R>,
) =>
	Layer.unwrap(
		makeExportReads.pipe(
			Effect.map((reads) =>
				Layer.merge(build(reads), Layer.succeed(FakeExportReads, reads.service)),
			),
		),
	);

const privateRecordsEventsPath = `${tmpdir()}/backup-export-installations-${crypto.randomUUID()}.ndjson`;
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
	activeConfigRevisionId: "source-config-revision",
	config: {
		unit: "minutes",
		credentials: { token: "secret", region: "local" },
		accounts: [{ label: "primary", token: "array-secret" }],
	},
};
const privateManifest = {
	...fixtureManifest(),
	crons: [],
	hooks: [],
	scripts: [],
	workflows: [],
	providers: [],
	operations: [],
	savedViews: [],
	signalSchemas: [],
	userBootstrap: [],
	relationshipSchemas: [],
	metadata: { ...fixtureManifest().metadata, slug: "private-plugin" },
	entitySchemas: [
		{
			icon: "box",
			eventSchemas: [],
			name: "Private Record",
			slug: "private-record",
			propertiesSchema: {
				fields: {
					title: { label: "Title", description: "Title", type: "string" as const },
					token: {
						label: "Token",
						description: "Token",
						secret: true as const,
						type: "string" as const,
					},
					relatedEntityId: {
						label: "Related entity",
						type: "string" as const,
						description: "Related entity",
						reference: { kind: "entity-id" as const },
					},
				},
			},
		},
	],
	integrationProviders: [
		{
			lot: "push" as const,
			slug: "private-push",
			name: "Private Push",
			description: "Private push integration",
			settingsSchema: {
				unknownKeys: "strict" as const,
				fields: {
					endpoint: {
						validation: {},
						label: "Endpoint",
						description: "Endpoint",
						type: "string" as const,
					},
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
				},
			},
		},
	],
	configSchema: {
		unknownKeys: "strict" as const,
		fields: {
			unit: { label: "Unit", validation: {}, description: "Unit", type: "string" as const },
			credentials: {
				label: "Credentials",
				type: "object" as const,
				description: "Credentials",
				properties: {
					region: { label: "Region", description: "Region", type: "string" as const },
					token: {
						label: "Token",
						description: "Token",
						secret: true as const,
						type: "string" as const,
						validation: { required: true as const },
					},
				},
			},
			accounts: {
				label: "Accounts",
				type: "array" as const,
				description: "Accounts",
				items: {
					label: "Account",
					description: "Account",
					type: "object" as const,
					properties: {
						label: { label: "Label", description: "Label", type: "string" as const },
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
		},
	},
};
const privateSourceFiles = { "client/asset.png": new Uint8Array([0x00, 0xff, 0x80, 0x41]) };
const privateSourceHash = pluginSourceHash(privateManifest, privateSourceFiles, []);
const differentOwnerManifest = {
	...privateManifest,
	entitySchemas: privateManifest.entitySchemas.map((definition) => ({
		...definition,
		propertiesSchema: {
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		},
	})),
};
const effectiveDefinitions = buildDefinitionSnapshot(
	mergeManifestDefinitions(
		{
			savedViews: [],
			entitySchemas: [],
			relationshipSchemas: [],
			signalSchemas: [
				{
					name: "Default signal",
					slug: "default.signal",
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationHookSlug: "automation.notification",
				},
				{
					name: "Changed signal",
					slug: "changed.signal",
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationHookSlug: "automation.notification",
				},
			],
		},
		[{ slug: "private-plugin", id: "different-plugin-id", manifest: differentOwnerManifest }],
	),
);
const privateTimestamp = new Date("2026-08-24T12:00:00.000Z");

const privateRecordsExportLayer = withExportReads((reads) =>
	BackupExportSnapshot.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				BunFileSystem.layer,
				Layer.mock(DefinitionRepository, {
					getUserSnapshot: (_userId, options) =>
						Ref.update(reads.definitionReads, (count) => count + 1).pipe(
							Effect.andThen(
								Effect.sync(() => {
									expect(options.listed).toBe(true);
									return effectiveDefinitions;
								}),
							),
						),
				}),
				Layer.mock(AuthRepository, {
					getPortableProfile: () =>
						Effect.succeed({
							image: null,
							name: "Owner",
							preferences: { language: null, allowNsfw: false, disableIntegrations: false },
						}),
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
					listReferencedGlobalEntitiesForBackup: () => Effect.succeed([]),
					listGlobalEntitiesByIdsForBackup: (ids) =>
						Ref.set(reads.embeddedDependencyIds, ids).pipe(
							Effect.as([
								{
									provider: null,
									externalId: null,
									populatedAt: null,
									id: "private-dependency",
									name: "Private dependency",
									createdAt: privateTimestamp,
									updatedAt: privateTimestamp,
									entitySchemaSlug: "private-record",
									entitySchemaPluginId: "private-plugin-id",
									properties: { title: "Dependency", token: "dependency-secret" },
								},
							]),
						),
					listUserEntitiesForBackup: () =>
						Effect.succeed([
							{
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
				}),
				Layer.mock(SavedViewsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(TranslationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(RelationshipsRepository, {
					listUserRelationshipsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(AutomationsRepository, {
					listNotificationSubscriptionsForBackup: () =>
						Effect.succeed([
							{
								userId,
								metadata: null,
								isActive: true,
								signalSchemaPluginId: null,
								createdAt: privateTimestamp.toISOString(),
								updatedAt: privateTimestamp.toISOString(),
								id: NotificationSubscriptionId.make("default-rule"),
								signalSchemaSlug: SignalSchemaSlug.make("default.signal"),
							},
							{
								userId,
								metadata: null,
								isActive: false,
								signalSchemaPluginId: null,
								createdAt: privateTimestamp.toISOString(),
								updatedAt: privateTimestamp.toISOString(),
								id: NotificationSubscriptionId.make("changed-rule"),
								signalSchemaSlug: SignalSchemaSlug.make("changed.signal"),
							},
						]),
				}),
				Layer.mock(ManagedAssetsService, { verifyManagedAssetOwnership: () => Effect.succeed([]) }),
				Layer.mock(PluginRepository, {
					listSourceFiles: () => Effect.succeed(privateSourceFiles),
					listCompiledPackageArtifacts: () => Effect.succeed({ compiledScripts: [] }),
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
								activationId: "private-activation",
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
								client: undefined,
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
					listHydratedForUser: () =>
						Effect.succeed([
							configuredSystemInstallation,
							defaultSystemInstallation,
							unavailableSystemInstallation,
							privateInstallation,
						]),
				}),
			),
		),
	),
);

layer(privateRecordsExportLayer)((test) => {
	test.effect(
		"exports private records from their persisted package when effective ownership differs",
		() =>
			Effect.gen(function* () {
				const snapshot = yield* BackupExportSnapshot;
				const prepared = yield* snapshot.prepareExportSnapshot(userId, privateRecordsEventsPath);
				const reads = yield* FakeExportReads;
				expect(yield* reads.definitionReads).toBe(1);
				expect(yield* reads.embeddedDependencyIds).toEqual(["private-dependency"]);
				expect(prepared.records.installations.map(({ packageKey }) => packageKey)).toEqual([
					`system:system-plugin:${"a".repeat(64)}`,
					`user:private-plugin:${privateSourceHash}`,
				]);
				expect(prepared.records.privatePlugins).toEqual([
					expect.objectContaining({
						compiledScripts: [],
						slug: "private-plugin",
						sourceHash: privateSourceHash,
						files: { "client/asset.png": "AP+AQQ==" },
						key: `user:private-plugin:${privateSourceHash}`,
					}),
				]);
				expect(prepared.records.entities).toEqual([
					expect.objectContaining({
						id: "private-entity",
						entitySchemaPluginKey: `user:private-plugin:${privateSourceHash}`,
						properties: { title: "Private title", relatedEntityId: "private-dependency" },
					}),
				]);
				expect(prepared.records.entities[0]).not.toHaveProperty("origin");
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
					"/credentials/token",
					"/accounts/0/token",
				]);
				expect(prepared.records.installations[1]).not.toHaveProperty("activeConfigRevisionId");
				expect(prepared.records.notificationSubscriptions).toEqual([
					{
						metadata: null,
						isActive: false,
						signalSchemaPluginKey: null,
						signalSchemaSlug: "changed.signal",
					},
				]);
				expect(prepared.records.integrations).toEqual([
					expect.objectContaining({
						configuredSecretPaths: ["/credentials/token"],
						packageKey: `user:private-plugin:${privateSourceHash}`,
						providerSpecifics: { credentials: {}, endpoint: "local" },
					}),
				]);
				expect(prepared.redactions.some((path) => path.includes("installation-system"))).toBe(
					false,
				);
				expect(prepared.requiredPlugins).toEqual([
					{ version: "1.0.0", slug: "system-plugin", sourceHash: "a".repeat(64) },
				]);
			}),
	);
});

const eventPagesPath = `${tmpdir()}/backup-export-events-${crypto.randomUUID()}.ndjson`;
const eventPagesTimestamp = new Date("2026-08-24T12:00:00.000Z");
const eventPagesManifest = {
	...fixtureManifest(),
	crons: [],
	hooks: [],
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
							note: { label: "Note", description: "Note", type: "string" as const },
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
const eventPagesSourceHash = pluginSourceHash(eventPagesManifest, {}, []);
const eventRow = (id: string, note: string) => ({
	id,
	note,
	sessionEntityId: null,
	entityId: "private-entity",
	eventSchemaSlug: "watched",
	createdAt: eventPagesTimestamp,
	updatedAt: eventPagesTimestamp,
	occurredAt: eventPagesTimestamp,
	eventSchemaPluginId: "private-plugin-id",
	properties: {
		note,
		token: "event-secret",
		poster: { type: "local", key: `permanent/${id}.bin` },
	},
});

const eventPagesExportLayer = withExportReads((reads) =>
	BackupExportSnapshot.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				BunFileSystem.layer,
				Layer.mock(DefinitionRepository, {
					getUserSnapshot: () =>
						Effect.succeed(
							buildDefinitionSnapshot(
								mergeManifestDefinitions(
									{ savedViews: [], entitySchemas: [], signalSchemas: [], relationshipSchemas: [] },
									[
										{
											slug: "private-plugin",
											id: "private-plugin-id",
											manifest: eventPagesManifest,
										},
									],
								),
							),
						),
				}),
				Layer.mock(AuthRepository, {
					getPortableProfile: () =>
						Effect.succeed({
							image: null,
							name: "Owner",
							preferences: { language: null, allowNsfw: false, disableIntegrations: false },
						}),
				}),
				Layer.mock(EventsRepository, {
					listUserEventsForBackup: ({ afterId }) =>
						Ref.update(reads.eventPageRequests, (all) => [...all, afterId]).pipe(
							Effect.map(() => {
								if (afterId === undefined) {
									return [eventRow("event-1", "first")];
								}
								return afterId === "event-1" ? [eventRow("event-2", "second")] : [];
							}),
						),
				}),
				Layer.mock(EntitiesRepository, {
					listGlobalEntitiesByIdsForBackup: () => Effect.succeed([]),
					listReferencedGlobalEntitiesForBackup: () => Effect.succeed([]),
					listUserEntitiesForBackup: () =>
						Effect.succeed([
							{
								properties: {},
								provider: null,
								externalId: null,
								populatedAt: null,
								id: "private-entity",
								name: "Private entity",
								createdAt: eventPagesTimestamp,
								updatedAt: eventPagesTimestamp,
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
						Ref.set(
							reads.requestedAssetKeys,
							locators.map(({ key }) => key),
						).pipe(
							Effect.as(
								locators.map((locator) => ({
									size: 1,
									ownerUserId,
									key: locator.key,
									provider: locator.type,
									contentType: "image/png",
									sha256: `sha-${locator.key}`,
									createdAt: eventPagesTimestamp,
								})),
							),
						),
				}),
				Layer.mock(PluginRepository, {
					listSourceFiles: () => Effect.succeed({}),
					listCompiledPackageArtifacts: () => Effect.succeed({ compiledScripts: [] }),
					listPortablePluginMetadata: () =>
						Ref.update(reads.portableReads, (count) => count + 1).pipe(Effect.as([])),
					listPrivateForUser: () =>
						Ref.update(reads.privateReads, (count) => count + 1).pipe(
							Effect.as([
								{
									scripts: [],
									ownerId: userId,
									slug: "private-plugin",
									scope: "user" as const,
									id: "private-plugin-id",
									status: "active" as const,
									manifest: eventPagesManifest,
									sourceHash: eventPagesSourceHash,
									activationId: "private-activation",
								},
							]),
						),
				}),
				Layer.mock(PluginInstallationRepository, { listHydratedForUser: () => Effect.succeed([]) }),
			),
		),
	),
);

layer(eventPagesExportLayer)((test) => {
	test.effect("reuses one export context across every event page", () =>
		Effect.gen(function* () {
			const snapshot = yield* BackupExportSnapshot;
			const prepared = yield* snapshot.prepareExportSnapshot(userId, eventPagesPath);
			const reads = yield* FakeExportReads;
			expect(yield* reads.portableReads).toBe(1);
			expect(yield* reads.privateReads).toBe(1);
			expect(yield* reads.eventPageRequests).toEqual([
				undefined,
				"event-1",
				"event-2",
				undefined,
				"event-1",
				"event-2",
			]);
			expect(yield* reads.requestedAssetKeys).toEqual([
				"permanent/event-1.bin",
				"permanent/event-2.bin",
			]);
			expect(prepared.events.count).toBe(2);
			expect(prepared.redactions).toEqual([
				"/events/event-1/properties/token",
				"/events/event-2/properties/token",
			]);
			const fs = yield* FileSystem.FileSystem;
			const written = (yield* fs.readFileString(eventPagesPath))
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(written.map(({ id }) => id)).toEqual(["event-1", "event-2"]);
			expect(written.map(({ properties }) => properties)).toEqual([
				{ note: "first", poster: { type: "local", key: "sha-permanent/event-1.bin" } },
				{ note: "second", poster: { type: "local", key: "sha-permanent/event-2.bin" } },
			]);
		}),
	);
});
