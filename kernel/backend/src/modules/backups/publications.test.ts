import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { encodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import { BackupRunId, EntityId, PublicationId, UserId } from "@ryot-app/contract/schema/brands";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import {
	clientArtifactFile,
	pageClientArtifactMetadata,
	pageDeclarationHash,
} from "@ryot-app/plugin-client-contract";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, FileSystem, Layer, Result, Stream } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { preparePageDefinition } from "#modules/pages/authoring/definition";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import type { PublicationSnapshot } from "#modules/publications/model";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { page } from "#schema/tables/pages";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { collectExportFixtureRecords } from "./archive/archive.test-support";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupRestorePersistence } from "./restore/persistence";
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
const capturedAssetBytes = new TextEncoder().encode("captured-asset");
const capturedAssetHash = sha256Hex(capturedAssetBytes);
const services = Layer.mergeAll(
	BackupExportSnapshot.layer,
	BackupRestoreWriter.layer,
	BackupRestorePersistence.layer,
).pipe(
	Layer.provideMerge(dependencies),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provideMerge(BunFileSystem.layer),
	Layer.provide(
		Layer.mock(ManagedAssetsService, {
			verifyManagedAssetOwnership: (ownerUserId, locators) =>
				Effect.succeed(
					locators.map((locator) => ({
						ownerUserId,
						retiredAt: null,
						key: locator.key,
						provider: locator.type,
						createdAt: new Date(0),
						contentType: "image/png",
						sha256: capturedAssetHash,
						size: capturedAssetBytes.byteLength,
					})),
				),
		}),
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

const subject = table("entity", "subject");
const definition: PageDefinition = {
	pluginDependencies: {},
	entry: "client/page.tsx",
	files: [
		{
			path: "client/page.tsx",
			content: Buffer.from("export default () => null;").toString("base64"),
		},
	],
	queries: {
		...document({ items: rows(subject, { fields: [field("id", column(subject, "id"))] }) }),
		parameters: {
			fields: {
				text: { label: "Text", type: "string", description: "Opaque text" },
				visitor: {
					type: "string",
					label: "Visitor",
					description: "Visitor input",
					validation: { required: true },
				},
				source: {
					type: "string",
					label: "Source",
					description: "Collection source",
					reference: { kind: "entity-source" },
				},
			},
		},
	},
};
const artifactFor = (label: string) => {
	const file = clientArtifactFile({
		path: "module.js",
		contentType: "text/javascript; charset=utf-8",
		bytes: new TextEncoder().encode(`export default () => "${label}";`),
	});
	return {
		...pageClientArtifactMetadata("page", [file], {
			imports: [],
			pageDeclarationHash: pageDeclarationHash(definition),
		}),
		files: [file],
	};
};

layer(services)((test) => {
	test.effect(
		"round-trips live bindings and frozen page code and results independently of current page code, without links",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const definitions = yield* DefinitionRepository;
				const persistence = yield* BackupRestorePersistence;
				const artifacts = yield* ClientArtifactsRepository;
				yield* session.transaction(definitions.replaceKernelDefinitions(kernelDefinitionSource()));
				const oldArtifact = artifactFor("captured");
				const currentArtifact = artifactFor("current");
				const currentDefinition: PageDefinition = {
					...definition,
					files: [
						{
							path: "client/page.tsx",
							content: Buffer.from('export default () => "updated page";').toString("base64"),
						},
					],
				};
				const current = yield* preparePageDefinition(currentDefinition);
				const prepared = yield* preparePageDefinition(definition);
				const source = encodeEntitySourceReference({
					kind: "collection",
					collectionId: EntityId.make("deleted-source"),
				});
				const snapshot: PublicationSnapshot = {
					document: definition.queries,
					settings: { title: "Frozen" },
					arguments: { source, visitor: "captured", text: "source-page" },
					page: {
						definition,
						revision: 1,
						authorityRevision: 1,
						pageId: "source-page",
						name: "Captured page",
						artifactHash: oldArtifact.hash,
						definitionHash: prepared.definitionHash,
					},
					result: {
						data: {
							items: {
								type: "rows",
								pageInfo: { limit: 20, hasMore: true, nextCursor: "captured-cursor" },
								items: [
									{
										id: "deleted-source",
										literal: "source-page",
										asset: { type: "local", key: "captured-source-asset" },
									},
								],
							},
						},
					},
				};
				yield* session.transaction(
					Effect.gen(function* () {
						yield* artifacts.persistClientArtifact(oldArtifact);
						yield* persistence.restorePage(
							{
								slug: "page",
								origin: "user",
								draftRevision: 2,
								id: "source-page",
								userId: sourceUser,
								name: "Current page",
								publishedRevision: 2,
								draftDefinition: currentDefinition,
								publishedDefinition: currentDefinition,
								publishedArtifactHash: currentArtifact.hash,
								draftDefinitionHash: current.definitionHash,
								publishedDefinitionHash: current.definitionHash,
							},
							currentArtifact,
						);
						yield* session.run((db) =>
							db.insert(tables.publication).values([
								{
									snapshot,
									icon: "share",
									title: "Frozen",
									userId: sourceUser,
									showOwnerName: false,
									pageId: "source-page",
									id: PublicationId.make("frozen"),
									snapshotArtifactHash: oldArtifact.hash,
									definition: {
										mode: "snapshot",
										arguments: { source },
										page: { kind: "page", pageId: "source-page" },
									},
								},
								{
									title: "Live",
									icon: "share",
									userId: sourceUser,
									showOwnerName: true,
									pageId: "source-page",
									id: PublicationId.make("live"),
									definition: {
										mode: "live",
										arguments: { text: "source-page" },
										page: { kind: "page", pageId: "source-page" },
									},
								},
								{
									icon: "share",
									title: "Revoked",
									userId: sourceUser,
									showOwnerName: false,
									revokedAt: createdAt,
									pageId: "source-page",
									id: PublicationId.make("revoked"),
									definition: {
										mode: "live",
										arguments: {},
										page: { kind: "page", pageId: "source-page" },
									},
								},
							]),
						);
						yield* session.run((db) =>
							db
								.insert(tables.publicationLink)
								.values({
									label: "Private link",
									tokenHash: "unexported-secret-hash",
									publicationId: PublicationId.make("frozen"),
								}),
						);
					}),
				);
				const fs = yield* FileSystem.FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-publication-backup-" });
				const exportRun = yield* beginRun("export", sourceUser);
				const exported = yield* session.transaction(
					(yield* BackupExportSnapshot).prepareExportSnapshot(
						sourceUser,
						`${directory}/events.ndjson`,
						exportRun,
					),
				);
				const records = yield* collectExportFixtureRecords(exported, fs);
				expect(records.publications).toHaveLength(2);
				expect(
					records.publications.find(({ title }) => title === "Live")?.definition.arguments,
				).toEqual({ text: "source-page" });
				expect(exported.blobs).toHaveLength(2);
				expect(exported.managedAssets.map(({ key }) => key)).toEqual(["captured-source-asset"]);
				expect(
					records.publications.find(({ title }) => title === "Frozen")?.snapshot?.result,
				).toMatchObject({
					data: { items: { items: [{ asset: { type: "local", key: capturedAssetHash } }] } },
				});
				expect(stableStringify(records.publications)).not.toContain("unexported-secret-hash");
				const archive = yield* validateArchiveStream(
					createArchiveStream({
						appVersion: "test",
						archiveId: exportRun,
						records: exported.records,
						redactions: exported.redactions,
						createdAt: createdAt.toISOString(),
						requiredPlugins: exported.requiredPlugins,
						blobs: exported.blobs.map(({ filePath, ...metadata }) => ({
							metadata,
							chunks: Stream.toAsyncIterable(fs.stream(filePath)),
						})),
						sections: exported.sections.map(({ filePath, ...section }) =>
							Object.assign(section, { chunks: Stream.toAsyncIterable(fs.stream(filePath)) }),
						),
						assets: [
							{
								chunks: [capturedAssetBytes],
								metadata: {
									contentType: "image/png",
									sha256: capturedAssetHash,
									path: `assets/${capturedAssetHash}`,
									size: capturedAssetBytes.byteLength,
								},
							},
						],
					}),
					{ directory },
				);
				const writer = yield* BackupRestoreWriter;
				const restoreRun = yield* beginRun("restore", destinationUser);
				const destinationDefinitions = yield* definitions.getUserSnapshot(destinationUser, {
					listed: true,
				});
				const blobs = new Map(archive.blobs.map((blob) => [blob.sha256, blob]));
				yield* writer.stageArchive(
					restoreRun,
					archive.records,
					archive.sections,
					new Map(),
					destinationDefinitions,
				);
				const withoutCapturedArtifact = new Map(blobs);
				for (const file of oldArtifact.files) {
					withoutCapturedArtifact.delete(sha256Hex(file.contents));
				}
				const missingCapture = yield* Effect.result(
					writer.preflightArchive(
						restoreRun,
						archive.records,
						new Map(),
						destinationDefinitions,
						[],
						withoutCapturedArtifact,
					),
				);
				expect(Result.isFailure(missingCapture)).toBe(true);
				yield* writer.preflightArchive(
					restoreRun,
					archive.records,
					new Map(),
					destinationDefinitions,
					[],
					blobs,
				);
				yield* session.transaction(
					writer.restoreArchive(
						destinationUser,
						restoreRun,
						archive.records,
						new Map(),
						destinationDefinitions,
						new Map([
							[`local:${capturedAssetHash}`, { type: "s3", key: "restored-captured-asset" }],
						]),
						blobs,
					),
				);
				const [restoredPage] = yield* session.run((db) =>
					db.select().from(page).where(eq(page.userId, destinationUser)),
				);
				assert(restoredPage);
				expect(restoredPage.id).not.toBe("source-page");
				expect(restoredPage.publishedArtifactHash).toBe(currentArtifact.hash);
				const restored = yield* session.run((db) =>
					db
						.select()
						.from(tables.publication)
						.where(eq(tables.publication.userId, destinationUser)),
				);
				const frozen = restored.find(({ title }) => title === "Frozen");
				const live = restored.find(({ title }) => title === "Live");
				assert(frozen?.snapshot && live);
				expect(frozen.definition.page).toEqual({ kind: "page", pageId: restoredPage.id });
				expect(frozen.snapshot.page?.pageId).toBe(restoredPage.id);
				expect(frozen.snapshot.page?.definition).toEqual(definition);
				expect(restoredPage.publishedDefinition).toEqual(currentDefinition);
				expect(frozen.snapshotArtifactHash).toBe(oldArtifact.hash);
				expect(frozen.snapshot.result).toEqual({
					data: {
						items: {
							type: "rows",
							pageInfo: { limit: 20, hasMore: true, nextCursor: "captured-cursor" },
							items: [
								{
									id: "deleted-source",
									literal: "source-page",
									asset: { type: "s3", key: "restored-captured-asset" },
								},
							],
						},
					},
				});
				expect(frozen.snapshot.arguments).toEqual(snapshot.arguments);
				expect(frozen.snapshot.settings).toEqual(snapshot.settings);
				expect(live.definition.arguments).toEqual({ text: "source-page" });
				expect(live.snapshot).toBeNull();
				expect(frozen.revision).toBe(1);
				expect(yield* artifacts.loadClientArtifact(oldArtifact.hash)).toEqual(oldArtifact);
				expect(
					yield* session.run((db) =>
						db
							.select()
							.from(tables.publicationLink)
							.where(eq(tables.publicationLink.publicationId, frozen.id)),
					),
				).toEqual([]);
			}),
		testTimeout,
	);
});
