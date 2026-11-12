import { expect } from "bun:test";
import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { BadRequest } from "@ryot-app/contract/errors";
import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import { decodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import type {
	ListedSavedView,
	ResultsTableSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import {
	BackupRunId,
	EntityId,
	EntitySchemaSlug,
	NotificationSubscriptionId,
	PluginId,
	PluginPackageId,
	PublicationId,
	SavedViewId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { fixtureManifest, testPluginPackageId } from "@ryot-app/contract/testing";
import { buildDefinitionSnapshot } from "@ryot-app/definitions/snapshot";
import { mergeManifestDefinitions } from "@ryot-app/definitions/source";
import {
	CLIENT_API_VERSION,
	clientArtifactMetadata,
	clientDeclarationHash,
} from "@ryot-app/plugin-client-contract";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { objectContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, FileSystem, Layer, Ref, Result } from "effect";

import { collectManagedAssetLocators } from "#lib/domain/managed-asset-locators";
import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { BackupStaging } from "#modules/backups/staging";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { pluginContentHash } from "#modules/plugins/packages/pipeline";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { fixtureClientArtifact } from "#modules/plugins/source.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import * as tables from "#schema/tables/combined";

import { collectExportFixtureRecords } from "../archive/archive.test-support";
import { ARCHIVE_CODECS } from "../archive/schemas";
import { decodeNdjson, IncrementalSha256 } from "../archive/streaming";
import { publicationDefinition } from "../publications.test-support";
import { BackupExportRepository, type BackupPropertyReferenceDeclaration } from "./repository";
import {
	BackupExportSnapshot,
	definitionForPlugin,
	eventEntityReferencePaths,
	requireNotificationMetadataSchema,
	requirePluginKey,
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

it("collects nested managed assets once per locator", () => {
	const asset = {
		type: "object",
		properties: {},
		label: "Asset",
		description: "Asset",
		validation: { asset: true },
	} as const;
	const propertiesSchema: AppSchema = {
		fields: {
			cover: asset,
			gallery: {
				type: "array",
				label: "Gallery",
				description: "Gallery",
				items: {
					type: "object",
					label: "Gallery item",
					description: "Gallery item",
					properties: { image: asset },
				},
			},
		},
	};
	expect(
		collectManagedAssetLocators([
			{
				propertiesSchema,
				properties: {
					cover: { type: "local", key: "permanent/one.bin" },
					gallery: [
						{ image: { type: "s3", key: "permanent/two.png" } },
						{ image: { type: "local", key: "permanent/one.bin" } },
					],
				},
			},
		]),
	).toEqual([
		{ type: "local", key: "permanent/one.bin" },
		{ type: "s3", key: "permanent/two.png" },
	]);
});

it.effect(
	"rejects non-null notification metadata without its signal schema",
	() =>
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
	testTimeout,
);

it.effect(
	"resolves archive keys from persisted plugin IDs",
	() =>
		Effect.gen(function* () {
			const persistedKey = pluginPackageKey({
				scope: "user",
				packageId: fixtureManifest().metadata.packageId,
			});
			const currentKey = pluginPackageKey({ scope: "user", packageId: testPluginPackageId() });
			const keys = new Map([
				["current-plugin", currentKey],
				["persisted-plugin", persistedKey],
			]);
			expect(yield* requirePluginKey(keys, "persisted-plugin")).toBe(persistedKey);
			assertExitFails(
				yield* Effect.exit(requirePluginKey(keys, "unavailable-plugin")),
				new BadRequest({ message: "Backup references unavailable plugin 'unavailable-plugin'" }),
			);
		}),
	testTimeout,
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
	readonly packageId: PluginPackageId;
	readonly pluginScope: "user" | "system";
}) => ({
	...input,
	userId,
	config: {},
	sortOrder: 0,
	isHidden: false,
	userSettings: {},
	healthReason: null,
	isInitialized: true,
	uninstalledAt: null,
	homeSavedView: null,
	health: "ready" as const,
	incompatibilityReason: null,
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
>()("@ryot-app/kernel-backend/modules/backups/export/snapshot.test/FakeExportReads") {}

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
const privateRecordsRunId = BackupRunId.make("backup-export-private-records-test");
const systemPackageId = PluginPackageId.make("test/system");
const defaultPackageId = PluginPackageId.make("test/default");
const systemInstallation = installationRow({
	pluginScope: "system",
	id: "installation-system",
	packageId: systemPackageId,
	pluginId: "system-plugin-id",
});
const configuredSystemInstallation = {
	...systemInstallation,
	config: { locale: "source-only", token: "source-system-secret" },
};
const unavailableSystemInstallation = installationRow({
	pluginScope: "system",
	id: "installation-unavailable",
	pluginId: "unavailable-plugin-id",
	packageId: PluginPackageId.make("test/unavailable"),
});
const defaultSystemInstallation = installationRow({
	pluginScope: "system",
	id: "installation-default",
	packageId: defaultPackageId,
	pluginId: "default-plugin-id",
});
const privateInstallation = {
	...installationRow({
		pluginScope: "user",
		id: "installation-private",
		pluginId: "private-plugin-id",
		packageId: fixtureManifest().metadata.packageId,
	}),
	health: "incompatible" as const,
	activeConfigRevisionId: "source-config-revision",
	incompatibilityReason: "package-identity-conflict" as const,
	config: { token: "secret", unit: "minutes", region: "local", accountToken: "account-secret" },
};
const retainedCalendarSource: PluginCalendarSource = {
	icon: "calendar",
	startAt: "startAt",
	precision: "instant",
	name: "Retained dates",
	slug: "retained-dates",
	subject: {
		entityAlias: "retained",
		schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("private-record") }],
	},
	query: {
		from: table("entity", "retained"),
		output: {
			type: "rows",
			fields: [field("startAt", column(table("entity", "retained"), "createdAt"))],
		},
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
	signalSchemas: [],
	userBootstrap: [],
	relationshipSchemas: [],
	metadata: fixtureManifest().metadata,
	calendarSources: [retainedCalendarSource],
	client: {
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		exports: {
			card: {
				entry: "client/card.tsx",
				kind: "component" as const,
				automaticEntityPresentations: false,
			},
		},
	},
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
	savedViews: [
		{
			icon: "box",
			sortOrder: 0,
			slug: "retained-view",
			name: "Retained view",
			renderer: { kind: "kernel" as const, name: "results-table" as const },
			dataSources: document({
				records: rows(table("entity", "retained"), {
					fields: [field("id", column(table("entity", "retained"), "id"))],
				}),
			}),
			settings: {
				pageSize: 50,
				entityLink: null,
				rowKeyFields: ["id"],
				sourceName: "records",
				columns: [{ field: "id", label: "Id", displayKind: "text" }],
			} satisfies ResultsTableSavedViewSettings,
		},
	],
	configSchema: {
		unknownKeys: "strict" as const,
		fields: {
			region: { label: "Region", description: "Region", type: "string" as const },
			unit: { label: "Unit", validation: {}, description: "Unit", type: "string" as const },
			token: {
				label: "Token",
				description: "Token",
				secret: true as const,
				type: "string" as const,
				validation: { required: true as const },
			},
			accountToken: {
				secret: true as const,
				label: "Account token",
				type: "string" as const,
				description: "Account token",
				validation: { required: true as const },
			},
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
};
const privateCompiledFiles = [
	...fixtureClientArtifact(
		privateManifest.metadata.name,
		privateManifest.metadata.packageId,
		privateManifest.client,
	).files,
	{
		name: "asset.png",
		contentType: "image/png",
		contents: new Uint8Array([0x00, 0xff, 0x80, 0x41]),
	},
];
const privateCompiledClient = {
	...clientArtifactMetadata(
		privateManifest.metadata.name,
		privateManifest.metadata.packageId,
		privateCompiledFiles,
		{ imports: [], clientDeclarationHash: clientDeclarationHash(privateManifest.client) },
	),
	files: privateCompiledFiles,
};
const privateSourceHash = pluginContentHash(privateManifest, [], privateCompiledClient);
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
			calendarSources: [],
			relationshipSchemas: [],
			signalSchemas: [
				{
					pluginId: null,
					name: "Default signal",
					slug: "default.signal",
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationHookSlug: "automation.notification",
				},
				{
					pluginId: null,
					name: "Changed signal",
					slug: "changed.signal",
					catalogState: "active",
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" },
					notificationHookSlug: "automation.notification",
				},
			],
		},
		[{ id: "different-plugin-id", manifest: differentOwnerManifest }],
	),
);
const privateTimestamp = new Date("2026-08-24T12:00:00.000Z");
const privateKey = pluginPackageKey({
	scope: "user",
	packageId: privateManifest.metadata.packageId,
});
const systemKey = pluginPackageKey({ scope: "system", packageId: systemPackageId });
const storedSystemPlugin = (id: string, packageId: PluginPackageId, contentHash: string) => ({
	id,
	packageId,
	contentHash,
	scripts: [],
	ownerId: null,
	status: "active",
	scope: "system" as const,
	activationId: `${id}-activation`,
	manifest: {
		...fixtureManifest(packageId),
		metadata: { ...fixtureManifest(packageId).metadata, version: "1.0.0" },
	},
});

const pluginViewPublication = (id: string, pluginId: string) => ({
	icon: "share",
	snapshot: null,
	description: null,
	showOwnerName: false,
	title: "Plugin view",
	pageDefinition: null,
	id: PublicationId.make(id),
	createdAt: privateTimestamp,
	definition: publicationDefinition({
		kind: "saved-view" as const,
		reference: {
			slug: "retained-view",
			kind: "plugin" as const,
			pluginId: PluginId.make(pluginId),
		},
	}),
});

const privateRecordsExportLayer = (savedViews: ListedSavedView[] = []) =>
	withExportReads((reads) =>
		Layer.effect(BackupExportSnapshot, BackupExportSnapshot.make).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					Layer.mock(ClientArtifactsRepository, {}),
					Layer.mock(BackupExportRepository, {
						listPages: () => Effect.succeed([]),
						assertMetadataBounds: () => Effect.void,
						listReminders: () => Effect.succeed([]),
						discoverDependencies: () => Effect.void,
						listFoldValues: () => Effect.succeed([]),
						discoverSnapshotDependencies: () => Effect.succeed(0),
						addDependencyIds: (_runId, ids) => Ref.set(reads.embeddedDependencyIds, ids),
						listReferencedInstallationIds: () => Effect.succeed(["installation-private"]),
						listSavedViewOverrides: (_userId, page) =>
							Effect.succeed(
								page?.after === undefined
									? [
											{
												userId,
												revision: 1,
												sortOrder: 4,
												isHidden: true,
												slug: "retained-view",
												pluginId: "private-plugin-id",
											},
										]
									: [],
							),
						listCalendarSourceOverrides: (_userId, page) =>
							Effect.succeed(
								page?.after === undefined
									? [
											{
												userId,
												isHidden: true,
												slug: "retained-dates",
												pluginId: "private-plugin-id",
											},
											{
												userId,
												isHidden: true,
												slug: "removed-dates",
												pluginId: "private-plugin-id",
											},
											{
												userId,
												isHidden: true,
												slug: "retained-dates",
												pluginId: "removed-plugin-id",
											},
										]
									: [],
							),
						listPublications: (_userId, page) =>
							Effect.succeed(
								page.afterId === undefined
									? [
											{
												icon: "share",
												snapshot: null,
												description: null,
												title: "Collection",
												showOwnerName: false,
												pageDefinition: null,
												createdAt: privateTimestamp,
												id: PublicationId.make("publication-collection"),
												definition: publicationDefinition({
													kind: "collection" as const,
													collectionId: EntityId.make("private-entity"),
												}),
											},
											pluginViewPublication("publication-retained", "private-plugin-id"),
											pluginViewPublication("publication-removed-plugin", "removed-plugin-id"),
											{
												icon: "share",
												snapshot: null,
												description: null,
												showOwnerName: false,
												pageDefinition: null,
												createdAt: privateTimestamp,
												title: "Removed kernel view",
												id: PublicationId.make("publication-removed-kernel"),
												definition: publicationDefinition({
													kind: "saved-view" as const,
													reference: { slug: "removed-view", kind: "kernel" as const },
												}),
											},
										]
									: [],
							),
					}),
					Layer.mock(BackupStaging, { listRecords: () => Effect.succeed([]) }),
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
								preferences: {
									language: null,
									reportingTimeZone: UTC,
									ratingScale: "hundred",
									disableIntegrations: false,
								},
							}),
					}),
					Layer.mock(EventsRepository, { listUserEventsForBackup: () => Effect.succeed([]) }),
					Layer.mock(IntegrationsRepository, {
						listForBackup: (_userId, page) =>
							Effect.succeed(
								page?.afterId === undefined
									? [
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
												pluginInstallationId: "installation-private",
												createdAt: new Date("2026-08-24T12:00:00.000Z"),
												updatedAt: new Date("2026-08-24T12:00:00.000Z"),
												extraSettings: { disableOnContinuousErrors: true },
												providerSpecifics: {
													endpoint: "local",
													credentials: { token: "integration-secret" },
												},
											},
										]
									: [],
							),
					}),
					Layer.mock(EntitiesRepository, {
						listGlobalEntitiesByIdsForBackup: (ids) =>
							Ref.set(reads.embeddedDependencyIds, ids).pipe(Effect.as([])),
						listUserEntitiesForBackup: (_userId, page) =>
							Effect.succeed(
								page?.afterId === undefined
									? [
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
													relatedEntityId: "private-entity",
												},
											},
										]
									: [],
							),
					}),
					Layer.mock(SavedViewsRepository, {
						listForBackup: (_userId, page) =>
							Effect.succeed(page?.afterId === undefined ? savedViews : []),
					}),
					Layer.mock(RelationshipsRepository, {
						listUserRelationshipsForBackup: () => Effect.succeed([]),
					}),
					Layer.mock(AutomationsRepository, {
						listNotificationSubscriptionsForBackup: (_userId, page) =>
							Effect.succeed(
								page?.afterId === undefined
									? [
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
										]
									: [],
							),
					}),
					Layer.mock(ManagedAssetsService, {
						verifyManagedAssetOwnership: () => Effect.succeed([]),
					}),
					Layer.mock(PluginRepository, {
						listCompiledPackageArtifacts: () =>
							Effect.succeed({ compiledScripts: [], compiledClient: privateCompiledClient }),
						listActiveSystemPlugins: () =>
							Effect.succeed([
								storedSystemPlugin("default-plugin-id", defaultPackageId, "b".repeat(64)),
								storedSystemPlugin("system-plugin-id", systemPackageId, "a".repeat(64)),
							]),
						listPrivateForUser: () =>
							Effect.succeed([
								{
									scripts: [],
									ownerId: userId,
									scope: "user" as const,
									id: "private-plugin-id",
									status: "active" as const,
									manifest: privateManifest,
									contentHash: privateSourceHash,
									activationId: "private-activation",
									packageId: privateManifest.metadata.packageId,
								},
							]),
					}),
					Layer.mock(PluginInstallationRepository, {
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

layer(privateRecordsExportLayer())((test) => {
	test.effect(
		"exports private records from their persisted package when effective ownership differs",
		() =>
			Effect.gen(function* () {
				const snapshot = yield* BackupExportSnapshot;
				const prepared = yield* snapshot.prepareExportSnapshot(
					userId,
					privateRecordsEventsPath,
					privateRecordsRunId,
				);
				const fs = yield* FileSystem.FileSystem;
				const records = yield* collectExportFixtureRecords(prepared, fs);
				const reads = yield* FakeExportReads;
				expect(yield* reads.definitionReads).toBe(1);
				expect(yield* reads.embeddedDependencyIds).toEqual([]);
				expect(prepared.records.installations.map(({ packageKey }) => packageKey)).toEqual([
					systemKey,
					privateKey,
				]);
				expect(prepared.records.privatePlugins).toEqual<unknown>([
					objectContaining({
						key: privateKey,
						compiledScripts: [],
						contentHash: privateSourceHash,
						compiledClient: privateCompiledClient,
						packageId: privateManifest.metadata.packageId,
					}),
				]);
				expect(prepared.records.privatePlugins[0]).not.toHaveProperty("files");
				expect(records.savedViews).toEqual<unknown>([
					objectContaining({
						sortOrder: 4,
						isHidden: true,
						slug: "retained-view",
						pluginKey: privateKey,
						kind: "builtin-override",
					}),
				]);
				expect(records.calendarSourceOverrides).toEqual([
					{ isHidden: true, pluginKey: privateKey, slug: "retained-dates" },
				]);
				expect(
					records.publications.map(({ id, definition }) => ({
						id,
						source: Result.getOrThrow(decodeEntitySourceReference(definition.arguments["source"])),
					})),
				).toEqual<unknown>([
					{
						id: "publication-collection",
						source: { kind: "collection", collectionId: "private-entity" },
					},
					{
						id: "publication-retained",
						source: {
							kind: "saved-view",
							reference: { kind: "plugin", pluginId: privateKey, slug: "retained-view" },
						},
					},
				]);
				expect(records.entities).toEqual<unknown>([
					objectContaining({
						id: "private-entity",
						entitySchemaPluginKey: privateKey,
						properties: { title: "Private title", relatedEntityId: "private-entity" },
					}),
				]);
				expect(records.entities[0]).not.toHaveProperty("origin");
				expect(records.entityDependencies).toEqual([]);
				expect(prepared.redactions).toContain("/entities/private-entity/properties/token");
				expect(prepared.records.installations[0]).toMatchObject({
					config: {},
					configuredSecretPaths: [],
				});
				expect(prepared.records.installations[1]?.config).toEqual({
					unit: "minutes",
					region: "local",
				});
				expect(prepared.records.installations[1]?.configuredSecretPaths).toEqual([
					"/token",
					"/accountToken",
				]);
				expect(prepared.redactions).toContain(
					'/installations/["user","test~1fixture"]/config/token',
				);
				expect(prepared.records.installations[1]).not.toHaveProperty("id");
				expect(prepared.redactions.some((path) => path.includes("installation-private"))).toBe(
					false,
				);
				expect(prepared.records.installations[1]).not.toHaveProperty("activeConfigRevisionId");
				expect(prepared.records.installations[1]).toMatchObject({
					hiddenIntent: false,
					isInitialized: true,
					lifecycleIntent: "incompatible",
					incompatibilityReason: "package-identity-conflict",
				});
				expect(records.notificationSubscriptions).toEqual([
					{
						metadata: null,
						isActive: false,
						signalSchemaPluginKey: null,
						signalSchemaSlug: "changed.signal",
					},
				]);
				expect(records.integrations).toEqual<unknown>([
					objectContaining({
						packageKey: privateKey,
						configuredSecretPaths: ["/credentials/token"],
						providerSpecifics: { credentials: {}, endpoint: "local" },
					}),
				]);
				expect(prepared.redactions.some((path) => path.includes("installation-system"))).toBe(
					false,
				);
				expect(prepared.requiredPlugins).toMatchObject([
					{ version: "1.0.0", packageId: systemPackageId, contentHash: "a".repeat(64) },
				]);
			}),
		testTimeout,
	);
});

const danglingViewId = SavedViewId.make("dangling-view");
layer(
	privateRecordsExportLayer([
		{
			icon: "box",
			sortOrder: 0,
			settings: {},
			isHidden: false,
			isBuiltin: false,
			dataSources: null,
			id: danglingViewId,
			name: "Dangling workspace",
			slug: "dangling-workspace",
			createdAt: "2026-08-24T12:00:00.000Z",
			updatedAt: "2026-08-24T12:00:00.000Z",
			pluginInstallationId: "missing-installation",
			renderer: { kind: "kernel", name: "results-table" },
			reference: { kind: "custom", savedViewId: danglingViewId },
		},
	]),
)((test) => {
	test.effect(
		"rejects a missing source workspace instead of exporting an unassociated view",
		() =>
			Effect.gen(function* () {
				const snapshot = yield* BackupExportSnapshot;
				assertExitFails(
					yield* Effect.exit(
						snapshot.prepareExportSnapshot(userId, privateRecordsEventsPath, privateRecordsRunId),
					),
					new BadRequest({
						message: "Backup saved view references unavailable plugin installation",
					}),
				);
			}),
		testTimeout,
	);
});

const eventPagesPath = `${tmpdir()}/backup-export-events-${crypto.randomUUID()}.ndjson`;
const eventPagesRunId = BackupRunId.make("backup-export-event-pages-test");
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
	metadata: fixtureManifest().metadata,
	configSchema: { fields: {}, unknownKeys: "strict" as const },
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
const eventPagesSourceHash = pluginContentHash(eventPagesManifest);
const eventRow = (id: string, note: string) => ({
	id,
	note,
	revision: 0,
	orderKey: null,
	userId: "owner",
	orderCreatedAt: null,
	sessionEntityId: null,
	entityId: "private-entity",
	eventSchemaSlug: "watched",
	createdAt: eventPagesTimestamp,
	updatedAt: eventPagesTimestamp,
	occurredAt: eventPagesTimestamp,
	entitySchemaSlug: "private-record",
	eventSchemaPluginId: "private-plugin-id",
	entitySchemaPluginId: "private-plugin-id",
	properties: {
		note,
		token: "event-secret",
		poster: { type: "local", key: `permanent/${id}.bin` },
	},
});

const eventPagesExportLayer = withExportReads((reads) =>
	Layer.effect(BackupExportSnapshot, BackupExportSnapshot.make).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				Layer.mock(ClientArtifactsRepository, {}),
				Layer.mock(BackupExportRepository, {
					listPages: () => Effect.succeed([]),
					addDependencyIds: () => Effect.void,
					assertMetadataBounds: () => Effect.void,
					listReminders: () => Effect.succeed([]),
					discoverDependencies: () => Effect.void,
					listFoldValues: () => Effect.succeed([]),
					listPublications: () => Effect.succeed([]),
					listSavedViewOverrides: () => Effect.succeed([]),
					listCalendarSourceOverrides: () => Effect.succeed([]),
					discoverSnapshotDependencies: () => Effect.succeed(0),
					listReferencedInstallationIds: () => Effect.succeed([]),
				}),
				Layer.mock(BackupStaging, { listRecords: () => Effect.succeed([]) }),
				BunFileSystem.layer,
				Layer.mock(DefinitionRepository, {
					getUserSnapshot: () =>
						Effect.succeed(
							buildDefinitionSnapshot(
								mergeManifestDefinitions(
									{
										savedViews: [],
										entitySchemas: [],
										signalSchemas: [],
										calendarSources: [],
										relationshipSchemas: [],
									},
									[{ id: "private-plugin-id", manifest: eventPagesManifest }],
								),
							),
						),
				}),
				Layer.mock(AuthRepository, {
					getPortableProfile: () =>
						Effect.succeed({
							image: null,
							name: "Owner",
							preferences: {
								language: null,
								reportingTimeZone: UTC,
								ratingScale: "hundred",
								disableIntegrations: false,
							},
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
					listUserEntitiesForBackup: (_userId, page) =>
						Effect.succeed(
							page?.afterId === undefined
								? [
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
									]
								: [],
						),
				}),
				Layer.mock(SavedViewsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(IntegrationsRepository, { listForBackup: () => Effect.succeed([]) }),
				Layer.mock(RelationshipsRepository, {
					listUserRelationshipsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(AutomationsRepository, {
					listNotificationSubscriptionsForBackup: () => Effect.succeed([]),
				}),
				Layer.mock(ManagedAssetsService, {
					verifyManagedAssetOwnership: (ownerUserId, locators) =>
						Ref.update(reads.requestedAssetKeys, (keys) => [
							...keys,
							...locators.map(({ key }) => key),
						]).pipe(
							Effect.as(
								locators.map((locator) => ({
									size: 1,
									ownerUserId,
									retiredAt: null,
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
					listCompiledPackageArtifacts: () => Effect.succeed({ compiledScripts: [] }),
					listActiveSystemPlugins: () =>
						Ref.update(reads.portableReads, (count) => count + 1).pipe(Effect.as([])),
					listPrivateForUser: () =>
						Ref.update(reads.privateReads, (count) => count + 1).pipe(
							Effect.as([
								{
									scripts: [],
									ownerId: userId,
									scope: "user" as const,
									id: "private-plugin-id",
									status: "active" as const,
									manifest: eventPagesManifest,
									contentHash: eventPagesSourceHash,
									activationId: "private-activation",
									packageId: eventPagesManifest.metadata.packageId,
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
	test.effect(
		"reuses one export context across every event page",
		() =>
			Effect.gen(function* () {
				const snapshot = yield* BackupExportSnapshot;
				const prepared = yield* snapshot.prepareExportSnapshot(
					userId,
					eventPagesPath,
					eventPagesRunId,
				);
				const reads = yield* FakeExportReads;
				expect(yield* reads.portableReads).toBe(1);
				expect(yield* reads.privateReads).toBe(1);
				expect(yield* reads.eventPageRequests).toEqual([undefined, "event-1", "event-2"]);
				expect(yield* reads.requestedAssetKeys).toEqual([
					"permanent/event-1.bin",
					"permanent/event-2.bin",
				]);
				expect(prepared.redactions).toEqual([
					"/events/event-1/properties/token",
					"/events/event-2/properties/token",
				]);
				const fs = yield* FileSystem.FileSystem;
				const eventSection = prepared.sections.find(({ path }) => path === "events.ndjson");
				assert(eventSection !== undefined);
				expect(eventSection.count).toBe(2);
				const eventBytes = yield* fs.readFile(eventSection.filePath);
				const eventHash = new IncrementalSha256();
				eventHash.update(eventBytes);
				expect(eventSection.bytes).toBe(eventBytes.byteLength);
				expect(eventSection.sha256).toBe(eventHash.digest().sha256);
				const written = Array.from(
					decodeNdjson([eventBytes], ARCHIVE_CODECS["events.ndjson"], eventSection.path),
				);
				expect(written.map(({ id }) => id)).toEqual(["event-1", "event-2"]);
				expect(written.map(({ properties }) => properties)).toEqual([
					{ note: "first", poster: { type: "local", key: "sha-permanent/event-1.bin" } },
					{ note: "second", poster: { type: "local", key: "sha-permanent/event-2.bin" } },
				]);
			}),
		testTimeout,
	);
});

const eventEntityReferenceSchema: AppSchema = {
	fields: {
		target: {
			type: "string",
			label: "Target",
			reference: { kind: "entity-id" },
			description: "Top-level reference",
		},
		matrix: {
			type: "array",
			label: "Groups",
			description: "Nested reference arrays",
			items: {
				type: "array",
				label: "Group",
				description: "Reference group",
				items: {
					type: "string",
					label: "Reference",
					description: "Retained entity",
					reference: { kind: "entity-id" },
				},
			},
		},
		details: {
			type: "object",
			label: "Details",
			description: "Nested event details",
			properties: {
				note: { label: "Note", type: "string", description: "Ordinary text" },
				items: {
					type: "array",
					label: "Items",
					description: "Nested references",
					items: {
						label: "Item",
						type: "object",
						description: "Nested reference",
						properties: {
							"target.id": {
								type: "string",
								label: "Target",
								description: "Entity reference",
								reference: { kind: "entity-id" },
							},
						},
					},
				},
			},
		},
	},
};

layer(
	Layer.mergeAll(BackupExportRepository.layer, BackupStaging.layer).pipe(
		Layer.provideMerge(revisionDatabaseLayer),
	),
)((test) => {
	test.effect(
		"stages nested event entity references within the exact account and schema owners",
		() =>
			Effect.gen(function* () {
				const fixtureNamespace = yield* randomUuid;
				const fixtureId = (name: string) => `${fixtureNamespace}-${name}`;
				const ownerId = UserId.make(fixtureId("owner"));
				const recipientId = UserId.make(fixtureId("recipient"));
				const session = yield* DatabaseSession;
				const repository = yield* BackupExportRepository;
				const staging = yield* BackupStaging;
				const runId = BackupRunId.make(fixtureId("run"));
				const noOpRunId = BackupRunId.make(fixtureId("noop-run"));
				const schemaOwnerA = fixtureId("schema-owner-a");
				const schemaOwnerB = fixtureId("schema-owner-b");
				const sourceA = fixtureId("event-source-a");
				const sourceB = fixtureId("event-source-b");
				const recipientSource = fixtureId("event-source-recipient");
				const kernelSource = fixtureId("event-source-kernel");
				const targetRoot = fixtureId("target-root");
				const targetMatrix = fixtureId("target-matrix");
				const targetNested = fixtureId("target-nested");
				const targetKernel = fixtureId("target-kernel");
				const targetOrdinary = fixtureId("target-ordinary");
				const targetOtherSchemaOwner = fixtureId("target-other-schema-owner");
				const targetOtherEventOwner = fixtureId("target-other-event-owner");
				const targetOtherAccount = fixtureId("target-other-account");
				const targetUserOwned = fixtureId("target-user-owned");
				const paths = eventEntityReferencePaths(eventEntityReferenceSchema);
				expect(paths).toEqual([
					'lax $."target"',
					'lax $."matrix"[*][*]',
					'lax $."details"."items"[*]."target.id"',
				]);
				yield* session.run((db) =>
					db.insert(user).values([
						{ id: ownerId, name: "Backup export owner", email: `${ownerId}@example.test` },
						{
							id: recipientId,
							name: "Backup export recipient",
							email: `${recipientId}@example.test`,
						},
					]),
				);
				yield* session.run((db) =>
					db.insert(tables.backupRun).values([
						{ id: runId, kind: "export", userId: ownerId, status: "completed" },
						{ id: noOpRunId, kind: "export", userId: ownerId, status: "completed" },
					]),
				);
				yield* staging.begin(runId);
				yield* staging.begin(noOpRunId);
				yield* session.run((db) =>
					db.insert(tables.plugin).values([
						{ id: schemaOwnerA, status: "inactive", packageId: testPluginPackageId() },
						{ id: schemaOwnerB, status: "inactive", packageId: testPluginPackageId() },
					]),
				);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values([
							{
								id: sourceA,
								userId: ownerId,
								name: "Source A",
								entitySchemaSlug: "record",
								entitySchemaPluginId: schemaOwnerA,
							},
							{
								id: sourceB,
								userId: ownerId,
								name: "Source B",
								entitySchemaSlug: "record",
								entitySchemaPluginId: schemaOwnerB,
							},
							{
								userId: recipientId,
								id: recipientSource,
								name: "Recipient source",
								entitySchemaSlug: "record",
								entitySchemaPluginId: schemaOwnerA,
							},
							{
								userId: ownerId,
								id: kernelSource,
								name: "Kernel source",
								entitySchemaSlug: "record",
							},
							...[
								targetRoot,
								targetMatrix,
								targetNested,
								targetKernel,
								targetOrdinary,
								targetOtherSchemaOwner,
								targetOtherEventOwner,
								targetOtherAccount,
							].map((id) => ({ id, name: id, entitySchemaSlug: "target" })),
							{
								userId: ownerId,
								name: "User target",
								id: targetUserOwned,
								entitySchemaSlug: "target",
							},
						]),
				);
				const properties = {
					target: targetRoot,
					matrix: [[], [targetMatrix, targetMatrix]],
					details: {
						note: targetOrdinary,
						items: [
							{},
							{ "target.id": targetNested },
							{ "target.id": targetNested },
							{ "target.id": targetUserOwned },
						],
					},
				};
				yield* session.run((db) =>
					db.insert(tables.event).values([
						{
							properties,
							userId: ownerId,
							entityId: sourceA,
							eventSchemaSlug: "evidence",
							occurredAt: eventPagesTimestamp,
							eventSchemaPluginId: schemaOwnerA,
							id: fixtureId("event-owner-match"),
						},
						{
							userId: ownerId,
							entityId: sourceB,
							eventSchemaSlug: "evidence",
							occurredAt: eventPagesTimestamp,
							eventSchemaPluginId: schemaOwnerA,
							id: fixtureId("event-other-schema-owner"),
							properties: { details: { items: [{ "target.id": targetOtherSchemaOwner }] } },
						},
						{
							userId: ownerId,
							entityId: sourceA,
							eventSchemaSlug: "evidence",
							occurredAt: eventPagesTimestamp,
							eventSchemaPluginId: schemaOwnerB,
							id: fixtureId("event-other-event-owner"),
							properties: { details: { items: [{ "target.id": targetOtherEventOwner }] } },
						},
						{
							userId: ownerId,
							entityId: kernelSource,
							eventSchemaSlug: "evidence",
							occurredAt: eventPagesTimestamp,
							properties: { target: targetKernel },
							id: fixtureId("event-kernel-owner-match"),
						},
						{
							userId: recipientId,
							entityId: recipientSource,
							eventSchemaSlug: "evidence",
							occurredAt: eventPagesTimestamp,
							eventSchemaPluginId: schemaOwnerA,
							id: fixtureId("event-other-account"),
							properties: { details: { items: [{ "target.id": targetOtherAccount }] } },
						},
					]),
				);

				const declarations: BackupPropertyReferenceDeclaration[] = [
					{
						paths,
						kind: "event",
						slug: "evidence",
						pluginId: schemaOwnerA,
						entitySchemaSlug: "record",
						entitySchemaPluginId: schemaOwnerA,
					},
					{
						paths,
						kind: "event",
						pluginId: null,
						slug: "evidence",
						entitySchemaSlug: "record",
						entitySchemaPluginId: null,
					},
				];
				yield* repository.discoverDependencies(runId, ownerId, declarations);
				expect(
					(yield* staging.listRecords(runId, "entity-dependencies.ndjson")).map(({ id }) => id),
				).toEqual([targetKernel, targetMatrix, targetNested, targetRoot].sort());

				yield* repository.discoverDependencies(noOpRunId, ownerId, []);
				expect(
					(yield* staging.listRecords(noOpRunId, "entity-dependencies.ndjson")).map(({ id }) => id),
				).toEqual([]);
			}),
		testTimeout,
	);
});
