import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import { BackupRunId, PluginId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import {
	clientArtifactFile,
	pageClientArtifactMetadata,
	pageDeclarationHash,
} from "@ryot-app/plugin-client-contract";
import { column, document, field, literal, pluginId, rows, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it, layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { DateTime, Effect, FileSystem, Layer, Stream } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { preparePageDefinition } from "#modules/pages/authoring/definition";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { page } from "#schema/tables/pages";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { archiveError } from "./archive/error";
import { BackupExportRepository } from "./export/repository";
import { BackupExportSnapshot } from "./export/snapshot";
import { exportPageDefinition, importPageDefinition, readPageArtifact } from "./pages";
import { BackupRestorePersistence } from "./restore/persistence";
import { BackupRestoreWriter } from "./restore/writer";
import { BackupStaging } from "./staging";

const sourceUser = UserId.make("owner");
const destinationUser = UserId.make("recipient");
const query = table("entity", "entity");
const definition: PageDefinition = {
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: document({ items: rows(query, { fields: [field("id", column(query, "id"))] }) }),
	files: [
		{
			path: "client/page.tsx",
			content: Buffer.from('export default () => "source-page";').toString("base64"),
		},
	],
};

it.effect(
	"remaps only typed page query owners and preserves source, assets and literal values",
	() =>
		Effect.gen(function* () {
			const sourceId = PluginId.make("source-owner");
			const destinationId = PluginId.make("restored-owner");
			const reference = { scope: "user" as const, packageId: testPluginPackageId() };
			const source: PageDefinition = {
				...definition,
				pluginDependencies: { helper: reference },
				queries: document({
					items: rows(query, {
						fields: [
							field("owner", pluginId({ kind: "local", pluginId: sourceId })),
							field("text", literal(sourceId)),
							field("json", literal({ kind: "local", pluginId: sourceId })),
						],
					}),
				}),
			};
			const exported = yield* exportPageDefinition(source, new Map([[sourceId, reference]]));
			const restored = yield* importPageDefinition(
				exported,
				new Map([[pluginPackageKey(reference), destinationId]]),
			);
			expect([...restored.definition.files]).toEqual([...source.files]);
			expect(restored.definition.pluginDependencies).toEqual(source.pluginDependencies);
			expect(restored.definition.queries.queries["items"]?.output).toMatchObject({
				fields: [
					{ expr: { type: "pluginId", reference: { kind: "local", pluginId: destinationId } } },
					{ expr: { type: "literal", value: sourceId } },
					{ expr: { type: "literal", value: { kind: "local", pluginId: sourceId } } },
				],
			});
			expect(pageDeclarationHash(restored.definition)).toBe(pageDeclarationHash(source));
			expect(restored.definitionHash).not.toBe(
				(yield* preparePageDefinition(source)).definitionHash,
			);
		}),
	testTimeout,
);

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
	BackupExportRepository.layer,
).pipe(
	Layer.provideMerge(dependencies),
	Layer.provideMerge(revisionDatabaseLayer),
	Layer.provideMerge(BunFileSystem.layer),
	Layer.provide(
		Layer.mock(ManagedAssetsService, { verifyManagedAssetOwnership: () => Effect.succeed([]) }),
	),
);

const beginRun = Effect.fn(function* (kind: "export" | "restore", userId: UserId) {
	const session = yield* DatabaseSession;
	const staging = yield* BackupStaging;
	const runId = BackupRunId.make(yield* randomUuid);
	yield* session.run((db) =>
		db.insert(tables.backupRun).values({ kind, userId, id: runId, status: "running" }),
	);
	yield* Effect.addFinalizer(() => staging.cleanup(runId).pipe(Effect.orDie));
	yield* staging.begin(runId);
	return runId;
});

layer(services)((test) => {
	test.effect(
		"treats a draft-only account as nonempty",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const userId = UserId.make("draft-only-owner");
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: userId, name: "Draft owner", email: "draft-only@test.local" }),
				);
				const prepared = yield* preparePageDefinition(definition);
				yield* session.transaction(
					(yield* BackupRestorePersistence).restorePage(
						{
							userId,
							slug: "draft",
							origin: "user",
							name: "Unpublished",
							draftDefinition: definition,
							draftDefinitionHash: prepared.definitionHash,
						},
						null,
					),
				);
				expect(
					(yield* (yield* BackupExportRepository).inspectRestoreTarget(userId))?.hasPages,
				).toBe(true);
			}),
		testTimeout,
	);

	test.effect(
		"round-trips pages and view references with large published binaries, without a compiler or preview artifacts",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const fs = yield* FileSystem.FileSystem;
				const definitions = yield* DefinitionRepository;
				const persistence = yield* BackupRestorePersistence;
				const artifacts = yield* ClientArtifactsRepository;
				yield* session.transaction(definitions.replaceKernelDefinitions(kernelDefinitionSource()));
				const file = clientArtifactFile({
					path: "module.js",
					contentType: "text/javascript; charset=utf-8",
					bytes: new TextEncoder().encode(
						`export const page = () => null; /*${"x".repeat(5 * 1024 * 1024)}*/`,
					),
				});
				const artifact = {
					...pageClientArtifactMetadata("page", [file], {
						imports: [],
						pageDeclarationHash: pageDeclarationHash(definition),
					}),
					files: [file],
				};
				const previewFile = clientArtifactFile({
					path: "module.js",
					contentType: "text/javascript; charset=utf-8",
					bytes: new TextEncoder().encode("export const page = () => 'preview';"),
				});
				const preview = {
					...pageClientArtifactMetadata("page", [previewFile], {
						imports: [],
						pageDeclarationHash: pageDeclarationHash(definition),
					}),
					files: [previewFile],
				};
				const prepared = yield* preparePageDefinition(definition);
				const draftDefinition = {
					...definition,
					files: [
						{
							path: "client/page.tsx",
							content: Buffer.from('export default () => "new draft";').toString("base64"),
						},
					],
				};
				const draft = yield* preparePageDefinition(draftDefinition);
				const staticDefinition: PageDefinition = { ...definition, queries: { queries: {} } };
				const staticPage = yield* preparePageDefinition(staticDefinition);
				const now = DateTime.toDate(DateTime.makeUnsafe("2026-11-11T00:00:00.000Z"));
				yield* session.transaction(
					Effect.gen(function* () {
						yield* artifacts.persistClientArtifact(preview);
						yield* persistence.restorePage(
							{
								slug: "static",
								origin: "user",
								userId: sourceUser,
								id: "source-static",
								name: "Static page",
								publishedRevision: 1,
								draftDefinition: staticDefinition,
								publishedArtifactHash: artifact.hash,
								publishedDefinition: staticDefinition,
								draftDefinitionHash: staticPage.definitionHash,
								publishedDefinitionHash: staticPage.definitionHash,
							},
							artifact,
						);
						yield* persistence.restorePage(
							{
								createdAt: now,
								updatedAt: now,
								draftDefinition,
								draftRevision: 4,
								id: "source-page",
								slug: "published",
								writeAccess: true,
								userId: sourceUser,
								origin: "assistant",
								authorityRevision: 7,
								publishedRevision: 3,
								name: "Published page",
								draftCompiledRevision: 4,
								publishedDefinition: definition,
								draftArtifactHash: preview.hash,
								publishedArtifactHash: artifact.hash,
								draftDefinitionHash: draft.definitionHash,
								publishedDefinitionHash: prepared.definitionHash,
							},
							artifact,
						);
						yield* persistence.restorePage(
							{
								slug: "draft",
								origin: "user",
								createdAt: now,
								updatedAt: now,
								draftRevision: 2,
								id: "source-draft",
								userId: sourceUser,
								name: "Draft only",
								writeAccess: false,
								authorityRevision: 2,
								draftCompiledRevision: 2,
								draftDefinition: definition,
								draftArtifactHash: preview.hash,
								draftDefinitionHash: prepared.definitionHash,
							},
							null,
						);
						yield* session.run((db) =>
							db
								.insert(tables.savedView)
								.values({
									icon: "file",
									settings: {},
									arguments: {},
									createdAt: now,
									updatedAt: now,
									slug: "page-view",
									name: "Page view",
									dataSources: null,
									userId: sourceUser,
									id: SavedViewId.make("source-view"),
									renderer: { kind: "page", pageId: "source-page" },
								}),
						);
					}),
				);
				expect(
					(yield* (yield* BackupExportRepository).inspectRestoreTarget(sourceUser))?.hasPages,
				).toBe(true);
				const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-page-backup-" });
				const exportRun = yield* beginRun("export", sourceUser);
				const exported = yield* session.transaction(
					(yield* BackupExportSnapshot).prepareExportSnapshot(
						sourceUser,
						`${directory}/events.ndjson`,
						exportRun,
					),
				);
				expect(exported.blobs).toHaveLength(1);
				expect(exported.blobs[0]?.size).toBeGreaterThan(4 * 1024 * 1024);
				const archive = yield* validateArchiveStream(
					createArchiveStream({
						assets: [],
						appVersion: "test",
						archiveId: exportRun,
						records: exported.records,
						createdAt: now.toISOString(),
						redactions: exported.redactions,
						requiredPlugins: exported.requiredPlugins,
						blobs: exported.blobs.map(({ filePath, ...metadata }) => ({
							metadata,
							chunks: Stream.toAsyncIterable(fs.stream(filePath)),
						})),
						sections: exported.sections.map(({ filePath, ...section }) =>
							Object.assign(section, { chunks: Stream.toAsyncIterable(fs.stream(filePath)) }),
						),
					}),
					{ directory },
				);
				const archivedPages = Array.from(
					yield* Stream.runCollect(archive.sections["pages.ndjson"].read()),
				);
				expect(archivedPages).toHaveLength(3);
				expect(archivedPages.find(({ id }) => id === "source-draft")?.published).toBeNull();
				const archivedPublished = archivedPages.find(({ id }) => id === "source-page")?.published;
				assert(archivedPublished);
				expect(archivedPublished.artifact.hash).toBe(artifact.hash);
				expect(archive.blobs).toHaveLength(1);
				const blobs = new Map(archive.blobs.map((blob) => [blob.sha256, blob]));
				const blob = archive.blobs[0];
				assert(blob);
				const corrupt = file.contents.slice();
				corrupt[0] = 0;
				assertExitFails(
					yield* Effect.exit(
						readPageArtifact(
							archivedPublished.artifact,
							archivedPublished.definition,
							new Map([[blob.sha256, { ...blob, stream: Stream.succeed(corrupt) }]]),
						),
					),
					archiveError("checksum_mismatch", "Page artifact binary checksum mismatch", blob.path),
				);
				assertExitFails(
					yield* Effect.exit(
						readPageArtifact(
							{ ...archivedPublished.artifact, hash: preview.hash },
							definition,
							blobs,
						),
					),
					archiveError("invalid_entry", "Page artifact identity is invalid", "pages.ndjson"),
				);
				const writer = yield* BackupRestoreWriter;
				const destinationDefinitions = yield* definitions.getUserSnapshot(destinationUser, {
					listed: true,
				});
				const badRun = yield* beginRun("restore", destinationUser);
				const originalViews = Array.from(
					yield* Stream.runCollect(archive.sections["saved-views.ndjson"].read()),
				);
				const missingPageViews = originalViews.map((view) =>
					view.kind === "custom"
						? Object.assign({}, view, {
								renderer: { kind: "page" as const, pageId: "missing-page" },
							})
						: view,
				);
				assertExitFails(
					yield* Effect.exit(
						writer.stageArchive(
							badRun,
							archive.records,
							{
								...archive.sections,
								"saved-views.ndjson": {
									...archive.sections["saved-views.ndjson"],
									read: () => Stream.fromIterable(missingPageViews),
								},
							},
							new Map(),
							destinationDefinitions,
						),
					),
					archiveError(
						"missing_reference_mapping",
						"Backup contains a reference without a staged target mapping",
					),
				);
				expect(
					yield* session.run((db) =>
						db.select().from(page).where(eq(page.userId, destinationUser)),
					),
				).toEqual([]);

				yield* session.run((db) =>
					db
						.update(tables.backupRun)
						.set({ status: "failed" })
						.where(eq(tables.backupRun.id, badRun)),
				);
				const restoreRun = yield* beginRun("restore", destinationUser);
				yield* writer.stageArchive(
					restoreRun,
					archive.records,
					archive.sections,
					new Map(),
					destinationDefinitions,
				);
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
						new Map(),
						blobs,
					),
				);
				const restored = yield* session.run((db) =>
					db.select().from(page).where(eq(page.userId, destinationUser)),
				);
				const published = restored.find(({ slug }) => slug === "published");
				const restoredDraft = restored.find(({ slug }) => slug === "draft");
				const restoredStatic = restored.find(({ slug }) => slug === "static");
				assert(restoredStatic);
				expect(restoredStatic.publishedDefinition).toEqual(staticDefinition);
				expect(restoredStatic.publishedArtifactHash).toBe(artifact.hash);
				expect(restoredStatic.id).not.toBe("source-static");
				assert(published);
				assert(restoredDraft);
				expect(published).toMatchObject({
					createdAt: now,
					updatedAt: now,
					draftDefinition,
					draftRevision: 4,
					writeAccess: true,
					origin: "assistant",
					authorityRevision: 7,
					publishedRevision: 3,
					draftArtifactHash: null,
					draftCompiledRevision: null,
					publishedDefinition: definition,
					publishedArtifactHash: artifact.hash,
				});
				expect(published.id).not.toBe("source-page");
				expect(restoredDraft).toMatchObject({
					origin: "user",
					draftRevision: 2,
					writeAccess: false,
					authorityRevision: 2,
					publishedRevision: null,
					draftArtifactHash: null,
					publishedDefinition: null,
					publishedArtifactHash: null,
					draftCompiledRevision: null,
				});
				expect(restoredDraft.id).not.toBe("source-draft");
				const views = yield* session.run((db) =>
					db.select().from(tables.savedView).where(eq(tables.savedView.userId, destinationUser)),
				);
				expect(views).toHaveLength(1);
				expect(views[0]?.renderer).toEqual({ kind: "page", pageId: published.id });
				expect(views[0]?.pageId).toBe(published.id);
				expect(views[0]?.id).not.toBe("source-view");
				const restoredArtifact = yield* artifacts.loadClientArtifact(
					published.publishedArtifactHash ?? "",
				);
				expect(restoredArtifact).toEqual(artifact);
			}),
		testTimeout,
	);
});
