import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import { badRequest } from "@ryot-app/contract/errors";
import {
	BackupRunId,
	EntityId,
	PublicationId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, inArray } from "drizzle-orm";
import { Effect, FileSystem, Layer, Stream } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import {
	archiveFixtureMetadata,
	collectExportFixtureRecords,
	collectFixtureRecords,
} from "./archive/archive.test-support";
import type { ArchivePublication, ArchiveRecords } from "./archive/schemas";
import type { ArchiveMetadata, ArchiveSections } from "./archive/sections";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupRestorePersistence } from "./restore/persistence";
import { fixtureArchiveReaders } from "./restore/staging.test-support";
import { BackupRestoreWriter } from "./restore/writer";
import { BackupStaging } from "./staging";

const dependencies = Layer.mergeAll(
	BackupStaging.layer,
	AuthRepository.layer,
	AutomationsRepository.layer,
	EntitiesRepository.layer,
	EventsRepository.layer,
	IntegrationsRepository.layer,
	PluginInstallationRepository.layer,
	RelationshipsRepository.layer,
	SavedViewsRepository.layer,
	TranslationsRepository.layer,
).pipe(Layer.provide(makeAppConfigLayer()));
const services = Layer.mergeAll(
	BackupExportSnapshot.layer,
	BackupRestoreWriter.layer,
	BackupRestorePersistence.layer,
).pipe(
	Layer.provideMerge(dependencies),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provideMerge(BunFileSystem.layer),
	Layer.provide(
		Layer.mock(ManagedAssetsService, { verifyManagedAssetOwnership: () => Effect.succeed([]) }),
	),
);

const sourceUser = UserId.make("owner");
const destinationUser = UserId.make("recipient");
const createdAt = new Date("2026-10-01T00:00:00.000Z");

const beginRun = Effect.fn(function* (kind: "export" | "restore", userId: UserId) {
	const session = yield* DatabaseSession;
	const staging = yield* BackupStaging;
	const runId = BackupRunId.make(yield* randomUuid);
	yield* session.run((db) =>
		db.insert(tables.backupRun).values({ kind, userId, id: runId, status: "running" }),
	);
	yield* Effect.addFinalizer(() =>
		Effect.ensuring(
			staging.cleanup(runId).pipe(Effect.orDie),
			session
				.run((db) => db.delete(tables.backupRun).where(eq(tables.backupRun.id, runId)))
				.pipe(Effect.asVoid, Effect.orDie),
		),
	);
	yield* staging.begin(runId);
	return runId;
});

const replaceKernelDefinitions = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.transaction(
		(yield* DefinitionRepository).replaceKernelDefinitions(kernelDefinitionSource()),
	);
});

const stageAndPreflight = Effect.fn(function* (
	metadata: ArchiveMetadata,
	sections: ArchiveSections,
) {
	const writer = yield* BackupRestoreWriter;
	const definitions = yield* (yield* DefinitionRepository).getUserSnapshot(destinationUser, {
		listed: true,
	});
	const runId = yield* beginRun("restore", destinationUser);
	yield* writer.stageArchive(runId, metadata, sections, new Map(), definitions);
	yield* writer.preflightArchive(runId, metadata, new Map(), definitions, []);
	return { runId, definitions };
});

const publication = (source: ArchivePublication["source"]): ArchivePublication => ({
	source,
	icon: "share",
	description: null,
	showOwnerName: false,
	id: "archived-publication",
	title: "Archived publication",
	createdAt: createdAt.toISOString(),
});

const craftedRecords = (publications: ReadonlyArray<ArchivePublication>): ArchiveRecords => ({
	publications,
	entities: [],
	reminders: [],
	foldValues: [],
	savedViews: [],
	integrations: [],
	installations: [],
	relationships: [],
	privatePlugins: [],
	calendarSourceOverrides: [],
	notificationSubscriptions: [],
	profile: {
		image: null,
		name: "Archived",
		preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
	},
	entityDependencies: [
		{
			properties: {},
			provider: null,
			translations: [],
			externalId: null,
			kind: "snapshot",
			populatedAt: null,
			id: "global-collection",
			name: "Global collection",
			entitySchemaPluginKey: null,
			entitySchemaSlug: "collection",
			identity: { kind: "unmanaged" },
			createdAt: createdAt.toISOString(),
			updatedAt: createdAt.toISOString(),
		},
	],
});

const stageCrafted = (publications: ReadonlyArray<ArchivePublication>) => {
	const records = craftedRecords(publications);
	return stageAndPreflight(
		archiveFixtureMetadata(records),
		fixtureArchiveReaders(records, { count: 0, sha256: "", read: () => Stream.empty }),
	).pipe(Effect.scoped);
};

layer(services)((test) => {
	test.effect(
		"round-trips active publication definitions without links and skips revoked or stale ones",
		() =>
			Effect.gen(function* () {
				yield* replaceKernelDefinitions;
				const session = yield* DatabaseSession;
				const collectionId = EntityId.make("owner-collection");
				const collectionSource = { collectionId, kind: "collection" as const };
				const sourcePublicationIds = [
					"publication-collection",
					"publication-kernel",
					"publication-revoked",
					"publication-stale-collection",
					"publication-stale-kernel",
					"publication-stale-custom",
				].map((id) => PublicationId.make(id));
				yield* session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									id: collectionId,
									name: "Favorites",
									userId: sourceUser,
									entitySchemaPluginId: null,
									entitySchemaSlug: "collection",
								}),
						);
						yield* session.run((db) =>
							db.insert(tables.publication).values([
								{
									createdAt,
									revision: 3,
									icon: "folders",
									userId: sourceUser,
									showOwnerName: true,
									source: collectionSource,
									title: "Shared favorites",
									description: "Things worth sharing",
									id: PublicationId.make("publication-collection"),
								},
								{
									createdAt,
									icon: "list",
									description: null,
									userId: sourceUser,
									showOwnerName: false,
									title: "All collections",
									id: PublicationId.make("publication-kernel"),
									source: {
										kind: "saved-view",
										reference: { kind: "kernel", slug: "collections" },
									},
								},
								{
									createdAt,
									icon: "folders",
									title: "Revoked",
									description: null,
									userId: sourceUser,
									revokedAt: createdAt,
									showOwnerName: false,
									source: collectionSource,
									id: PublicationId.make("publication-revoked"),
								},
								{
									createdAt,
									icon: "folders",
									description: null,
									userId: sourceUser,
									showOwnerName: false,
									title: "Deleted collection",
									id: PublicationId.make("publication-stale-collection"),
									source: { kind: "collection", collectionId: EntityId.make("deleted-collection") },
								},
								{
									createdAt,
									icon: "list",
									description: null,
									userId: sourceUser,
									showOwnerName: false,
									title: "Removed kernel view",
									id: PublicationId.make("publication-stale-kernel"),
									source: {
										kind: "saved-view",
										reference: { kind: "kernel", slug: "removed-view" },
									},
								},
								{
									createdAt,
									icon: "list",
									description: null,
									userId: sourceUser,
									showOwnerName: false,
									title: "Deleted custom view",
									id: PublicationId.make("publication-stale-custom"),
									source: {
										kind: "saved-view",
										reference: { kind: "custom", savedViewId: SavedViewId.make("deleted-view") },
									},
								},
							]),
						);
						yield* session.run((db) =>
							db
								.insert(tables.publicationLink)
								.values({
									label: "Friends",
									tokenHash: "source-link-hash",
									publicationId: PublicationId.make("publication-collection"),
								}),
						);
					}),
				);
				const fs = yield* FileSystem.FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped();
				const exportRunId = yield* beginRun("export", sourceUser);
				const exported = yield* session.transaction(
					(yield* BackupExportSnapshot).prepareExportSnapshot(
						sourceUser,
						`${directory}/events`,
						exportRunId,
					),
				);
				const exportedRecords = yield* collectExportFixtureRecords(exported, fs);
				expect(exportedRecords.publications).toEqual([
					{
						icon: "folders",
						showOwnerName: true,
						title: "Shared favorites",
						id: "publication-collection",
						createdAt: createdAt.toISOString(),
						description: "Things worth sharing",
						source: { kind: "collection", collectionId: "owner-collection" },
					},
					{
						icon: "list",
						description: null,
						showOwnerName: false,
						title: "All collections",
						id: "publication-kernel",
						createdAt: createdAt.toISOString(),
						source: { kind: "saved-view", reference: { kind: "kernel", slug: "collections" } },
					},
				]);
				const archive = yield* validateArchiveStream(
					createArchiveStream({
						assets: [],
						appVersion: "test",
						records: exported.records,
						redactions: exported.redactions,
						createdAt: createdAt.toISOString(),
						archiveId: "publication-round-trip",
						requiredPlugins: exported.requiredPlugins,
						sections: exported.sections.map((section) => ({
							path: section.path,
							count: section.count,
							bytes: section.bytes,
							sha256: section.sha256,
							chunks: Stream.toAsyncIterable(fs.stream(section.filePath)),
						})),
					}),
					{ directory },
				);
				expect((yield* collectFixtureRecords(archive)).publications).toEqual(
					exportedRecords.publications,
				);
				const { runId, definitions } = yield* stageAndPreflight(archive.records, archive.sections);
				yield* session.transaction(
					(yield* BackupRestoreWriter).restoreArchive(
						destinationUser,
						runId,
						archive.records,
						new Map(),
						definitions,
						new Map(),
					),
				);
				const restoredCollection = (yield* (yield* EntitiesRepository).listUserEntitiesForBackup(
					destinationUser,
				)).find(({ name }) => name === "Favorites");
				assert(restoredCollection);
				expect(restoredCollection.id).not.toBe(collectionId);
				const restored = yield* session.run((db) =>
					db
						.select()
						.from(tables.publication)
						.where(eq(tables.publication.userId, destinationUser))
						.orderBy(tables.publication.title),
				);
				expect(restored).toMatchObject([
					{
						createdAt,
						revision: 1,
						icon: "list",
						revokedAt: null,
						description: null,
						showOwnerName: false,
						title: "All collections",
						source: { kind: "saved-view", reference: { kind: "kernel", slug: "collections" } },
					},
					{
						createdAt,
						revision: 1,
						icon: "folders",
						revokedAt: null,
						showOwnerName: true,
						title: "Shared favorites",
						description: "Things worth sharing",
						source: { kind: "collection", collectionId: restoredCollection.id },
					},
				]);
				for (const row of restored) {
					expect(sourcePublicationIds).not.toContain(row.id);
				}
				expect(
					yield* session.run((db) =>
						db
							.select()
							.from(tables.publicationLink)
							.where(
								inArray(
									tables.publicationLink.publicationId,
									restored.map(({ id }) => id),
								),
							),
					),
				).toEqual([]);
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"rejects publications whose sources are not restored user collections or archived views",
		() =>
			Effect.gen(function* () {
				yield* replaceKernelDefinitions;
				assertExitFails(
					yield* Effect.exit(
						stageCrafted([publication({ kind: "collection", collectionId: "global-collection" })]),
					),
					badRequest("Backup publication references an unavailable collection"),
				);
				for (const source of [
					{ kind: "collection", collectionId: "absent-collection" },
					{ kind: "saved-view", reference: { kind: "custom", savedViewId: "absent-view" } },
				] as const) {
					const error = yield* stageCrafted([publication(source)]).pipe(Effect.flip);
					expect(error).toMatchObject({
						_tag: "BackupArchiveError",
						reason: "missing_reference_mapping",
					});
				}
				const unavailableView = yield* stageCrafted([
					publication({ kind: "saved-view", reference: { kind: "kernel", slug: "absent-view" } }),
				]).pipe(Effect.flip);
				expect(unavailableView.message).toContain("unavailable publication saved view");
			}),
		testTimeout,
	);
});
