import { expect } from "bun:test";

import { BunFileSystem } from "@effect/platform-bun";
import { badRequest } from "@ryot-app/contract/errors";
import type { AssistantToolCall } from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import {
	AssistantConversationId,
	AssistantToolCallId,
	BackupRunId,
	PluginId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
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
import { assistantContext } from "#modules/assistant/context";
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
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as assistantTables from "#schema/tables/assistant";
import * as tables from "#schema/tables/combined";
import { page } from "#schema/tables/pages";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { archiveError } from "./archive/error";
import { BackupExportRepository } from "./export/repository";
import { BackupExportSnapshot } from "./export/snapshot";
import { exportPageDefinition, importPageDefinition, readPageArtifact } from "./pages";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
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
	BackupAccountCleanliness.layer,
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

const historicalAssistantCall = (id: string): AssistantToolCall => ({
	kind: "tool",
	tool: "execute",
	requiresApproval: true,
	modelCallId: `model-${id}`,
	id: AssistantToolCallId.make(id),
	arguments: {
		pageId: "assistant-page",
		text: "Preserve this opaque history",
		conversationId: "assistant-conversation-a",
	},
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
	test.effect(
		"round-trips bounded assistant history, redacts providers and interrupts executable work",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const fs = yield* FileSystem.FileSystem;
				const definitions = yield* DefinitionRepository;
				const source = UserId.make("assistant-backup-source");
				const destination = UserId.make("assistant-backup-destination");
				const providerOnly = UserId.make("assistant-backup-provider-only");
				const now = DateTime.toDate(DateTime.makeUnsafe("2026-11-11T00:00:00.000Z"));
				yield* session.run((db) =>
					db.insert(tables.user).values([
						{
							id: providerOnly,
							name: "Provider only",
							email: "assistant-provider-only@example.test",
						},
						{ id: source, name: "Source", email: "assistant-backup-source@example.test" },
						{
							id: destination,
							name: "Destination",
							email: "assistant-backup-destination@example.test",
						},
					]),
				);

				const prepared = yield* preparePageDefinition(definition);
				yield* session.transaction(
					Effect.gen(function* () {
						yield* (yield* BackupRestorePersistence).restorePage(
							{
								userId: source,
								origin: "assistant",
								id: "assistant-page",
								slug: "assistant-page",
								name: "Historical page",
								draftDefinition: definition,
								draftDefinitionHash: prepared.definitionHash,
							},
							null,
						);
						yield* session.run((db) =>
							db.insert(assistantTables.assistantConversation).values([
								{
									userId: source,
									nextSequence: 272,
									title: "Older conversation",
									id: "assistant-conversation-a",
								},
								{
									userId: source,
									nextSequence: 3,
									title: "Other conversation",
									id: "assistant-conversation-b",
								},
							]),
						);
						yield* session.run((db) =>
							db.insert(assistantTables.assistantTurn).values([
								{
									round: 1,
									userId: source,
									id: "assistant-turn-a",
									text: "Older question",
									requestId: "request-a",
									status: "awaiting-approval",
									conversationId: "assistant-conversation-a",
								},
								{
									round: 1,
									userId: source,
									completedAt: now,
									status: "completed",
									id: "assistant-turn-b",
									text: "Other question",
									requestId: "request-b",
									conversationId: "assistant-conversation-b",
								},
							]),
						);
						yield* session.run((db) =>
							db.insert(assistantTables.assistantToolCall).values([
								{
									round: 1,
									position: 0,
									userId: source,
									decidedAt: now,
									decision: "approve",
									turnId: "assistant-turn-a",
									id: "assistant-call-approved",
									conversationId: "assistant-conversation-a",
									call: historicalAssistantCall("assistant-call-approved"),
								},
								{
									round: 1,
									position: 2,
									userId: source,
									decidedAt: now,
									completedAt: now,
									decision: "approve",
									turnId: "assistant-turn-a",
									id: "assistant-call-approved:write:0",
									conversationId: "assistant-conversation-a",
									result: { truncated: false, value: { written: true } },
									call: {
										hostCallIndex: 0,
										kind: "capability",
										requiresApproval: true,
										arguments: { pageId: "assistant-page" },
										parentId: AssistantToolCallId.make("assistant-call-approved"),
										id: AssistantToolCallId.make("assistant-call-approved:write:0"),
										capability: {
											input: { type: "object" },
											output: { type: "object" },
											source: { kind: "kernel" },
											title: "Fixture capability",
											description: "Delete a page",
											id: CapabilityId.make("kernel:pages.delete"),
											hints: { readOnly: false, destructive: true, idempotent: false },
										},
									},
								},
								{
									round: 1,
									position: 1,
									userId: source,
									turnId: "assistant-turn-a",
									id: "assistant-call-pending",
									conversationId: "assistant-conversation-a",
									call: historicalAssistantCall("assistant-call-pending"),
								},
								{
									round: 1,
									position: 0,
									userId: source,
									decidedAt: now,
									completedAt: now,
									decision: "decline",
									turnId: "assistant-turn-b",
									id: "assistant-call-declined",
									conversationId: "assistant-conversation-b",
									call: historicalAssistantCall("assistant-call-declined"),
									result: { truncated: false, value: { declined: true, pageId: "assistant-page" } },
								},
							]),
						);
						yield* session.run((db) =>
							db.insert(assistantTables.assistantMessage).values([
								...Array.from({ length: 270 }, (_, index) => ({
									userId: source,
									sequence: index + 1,
									turnId: "assistant-turn-a",
									role: "assistant" as const,
									conversationId: "assistant-conversation-a",
									id: `old-message-${String(index).padStart(3, "0")}`,
									parts: [{ kind: "text" as const, text: `Old text ${index}` }],
								})),
								{
									sequence: 271,
									userId: source,
									role: "assistant",
									turnId: "assistant-turn-a",
									id: "assistant-message-calls",
									conversationId: "assistant-conversation-a",
									parts: [
										{ kind: "tool-call", call: historicalAssistantCall("assistant-call-approved") },
										{
											revision: 2,
											kind: "approval",
											decision: "approve",
											toolCallId: AssistantToolCallId.make("assistant-call-approved"),
										},
										{ kind: "tool-call", call: historicalAssistantCall("assistant-call-pending") },
										{
											draftRevision: 1,
											kind: "page-preview",
											pageId: "assistant-page",
											artifactHash: "a".repeat(64),
											definitionHash: prepared.definitionHash,
										},
									],
								},
								{
									sequence: 1,
									role: "tool",
									userId: source,
									turnId: "assistant-turn-b",
									id: "assistant-message-result",
									conversationId: "assistant-conversation-b",
									parts: [
										{ kind: "tool-call", call: historicalAssistantCall("assistant-call-declined") },
										{
											revision: 2,
											kind: "approval",
											decision: "decline",
											toolCallId: AssistantToolCallId.make("assistant-call-declined"),
										},
										{
											kind: "tool-result",
											toolCallId: AssistantToolCallId.make("assistant-call-declined"),
											result: {
												truncated: false,
												value: { declined: true, pageId: "assistant-page" },
											},
										},
									],
								},
							]),
						);
						yield* session.run((db) =>
							db
								.insert(assistantTables.assistantProvider)
								.values({
									userId: source,
									model: "historical-model",
									baseUrl: "https://model.example.test/v1",
									encryptedApiKey: {
										keyId: "source-key",
										nonce: "source-nonce",
										ciphertext: "NEVER-EXPORT-CIPHERTEXT",
									},
								}),
						);
					}),
				);
				const reads = yield* BackupExportRepository;
				yield* session.run((db) =>
					db
						.insert(assistantTables.assistantProvider)
						.values({
							userId: providerOnly,
							model: "keyless-model",
							baseUrl: "https://model.example.test/v1",
						}),
				);
				expect((yield* reads.inspectRestoreTarget(providerOnly))?.hasAssistant).toBe(true);
				expect(
					yield* Effect.flip((yield* BackupAccountCleanliness).assertAccountIsClean(providerOnly)),
				).toMatchObject({ reason: { category: "assistant", code: "account-not-clean" } });
				expect((yield* reads.inspectRestoreTarget(source))?.hasAssistant).toBe(true);
				expect((yield* reads.inspectRestoreTarget(destination))?.hasAssistant).toBe(false);
				expect(
					yield* Effect.flip((yield* BackupAccountCleanliness).assertAccountIsClean(source)),
				).toMatchObject({ reason: { category: "assistant", code: "account-not-clean" } });
				let after: string | undefined;
				let count = 0;
				let more = true;
				while (more) {
					const messagePage = yield* reads.listAssistantMessages(source, after);
					expect(messagePage.length).toBeLessThanOrEqual(1);
					more = messagePage.length > 0;
					count += messagePage.length;
					after = messagePage[0]?.id;
				}
				expect(count).toBe(272);
				const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-assistant-backup-" });
				const exportRun = yield* beginRun("export", source);
				const exported = yield* session.transaction(
					(yield* BackupExportSnapshot).prepareExportSnapshot(
						source,
						`${directory}/history`,
						exportRun,
					),
				);
				expect(exported.redactions).toContain("/assistant/provider/apiKey");
				const assistantSection = exported.sections.find(
					(section) => section.path === "assistant.ndjson",
				);
				assert(assistantSection);
				const json = yield* fs.readFileString(assistantSection.filePath);
				expect(json).not.toContain("NEVER-EXPORT-CIPHERTEXT");
				expect(json).not.toContain("encryptedApiKey");
				const archive = yield* validateArchiveStream(
					createArchiveStream({
						blobs: [],
						assets: [],
						appVersion: "test",
						archiveId: exportRun,
						records: exported.records,
						createdAt: now.toISOString(),
						redactions: exported.redactions,
						requiredPlugins: exported.requiredPlugins,
						sections: exported.sections.map(({ filePath, ...section }) =>
							Object.assign(section, { chunks: Stream.toAsyncIterable(fs.stream(filePath)) }),
						),
					}),
					{ directory },
				);
				const writer = yield* BackupRestoreWriter;
				const invalidRun = yield* beginRun("restore", destination);
				const snapshot = yield* definitions.getUserSnapshot(destination, { listed: true });
				assertExitFails(
					yield* Effect.exit(
						writer.stageArchive(
							invalidRun,
							archive.records,
							{
								...archive.sections,
								"assistant.ndjson": {
									...archive.sections["assistant.ndjson"],
									read: () =>
										archive.sections["assistant.ndjson"]
											.read()
											.pipe(
												Stream.map((record) =>
													record.kind === "message" && record.id === "assistant-message-calls"
														? Object.assign({}, record, {
																conversationId: AssistantConversationId.make(
																	"assistant-conversation-b",
																),
															})
														: record,
												),
											),
								},
							},
							new Map(),
							snapshot,
						),
					),
					badRequest("Backup assistant turn ownership is inconsistent"),
				);
				yield* session.run((db) =>
					db
						.update(tables.backupRun)
						.set({ status: "failed" })
						.where(eq(tables.backupRun.id, invalidRun)),
				);
				const restoreRun = yield* beginRun("restore", destination);

				yield* writer.stageArchive(
					restoreRun,
					archive.records,
					archive.sections,
					new Map(),
					snapshot,
				);
				yield* writer.preflightArchive(restoreRun, archive.records, new Map(), snapshot, []);
				yield* session.transaction(
					writer.restoreArchive(
						destination,
						restoreRun,
						archive.records,
						new Map(),
						snapshot,
						new Map(),
					),
				);
				const conversations = yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantConversation)
						.where(eq(assistantTables.assistantConversation.userId, destination)),
				);
				expect(conversations).toHaveLength(2);
				expect(
					conversations.every(
						(row) => !["assistant-conversation-a", "assistant-conversation-b"].includes(row.id),
					),
				).toBe(true);
				const turns = yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantTurn)
						.where(eq(assistantTables.assistantTurn.userId, destination)),
				);
				expect(turns.map((row) => row.status).sort()).toEqual(["completed", "interrupted"]);
				const calls = yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantToolCall)
						.where(eq(assistantTables.assistantToolCall.userId, destination)),
				);
				expect(calls).toHaveLength(4);
				expect(calls.every((row) => row.result !== null && row.call.id === row.id)).toBe(true);
				expect(calls.filter((row) => row.decision === null)).toHaveLength(1);
				expect(calls.filter((row) => row.decision === "approve")).toHaveLength(2);
				expect(calls.filter((row) => row.decision === "decline")).toHaveLength(1);
				const child = calls.find((row) => row.call.kind === "capability");
				assert(child?.call.kind === "capability");
				const parentId = child.call.parentId;
				expect(calls.find((row) => row.id === parentId)?.decision).toBe("approve");
				expect(child.result).toEqual({ truncated: false, value: { written: true } });
				for (const row of calls.filter((candidate) => candidate.call.kind === "tool")) {
					expect(row.call.arguments).toEqual({
						pageId: "assistant-page",
						text: "Preserve this opaque history",
						conversationId: "assistant-conversation-a",
					});
				}
				const messages = yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantMessage)
						.where(eq(assistantTables.assistantMessage.userId, destination)),
				);
				expect(messages).toHaveLength(274);
				const interruptedTurn = turns.find((turn) => turn.status === "interrupted");
				assert(interruptedTurn);
				const restoredConversation = conversations.find(
					(row) => row.id === interruptedTurn.conversationId,
				);
				assert(restoredConversation);
				const history = messages
					.filter((row) => row.conversationId === restoredConversation.id)
					.sort((a, b) => a.sequence - b.sequence);
				expect(restoredConversation.nextSequence).toBe((history.at(-1)?.sequence ?? 0) + 1);
				const nextMessage = {
					role: "user" as const,
					parts: [{ kind: "text" as const, text: "Continue after restore" }],
				};
				expect(assistantContext([...history, nextMessage]).at(-1)).toEqual(nextMessage);
				for (const call of calls.filter(
					(row) => row.turnId === interruptedTurn.id && row.call.kind === "tool",
				)) {
					expect(
						history
							.flatMap((row) => row.parts)
							.filter((part) => part.kind === "tool-result" && part.toolCallId === call.id),
					).toHaveLength(1);
				}
				expect(
					messages.some((row) =>
						row.parts.some((part) => part.kind === "text" && part.text === "Old text 269"),
					),
				).toBe(true);
				const [restoredPage] = yield* session.run((db) =>
					db.select().from(page).where(eq(page.userId, destination)),
				);
				assert(restoredPage);
				expect(restoredPage.draftArtifactHash).toBeNull();
				const preview = messages
					.flatMap((row) => row.parts)
					.find((part) => part.kind === "page-preview");
				assert(preview?.kind === "page-preview");
				expect(preview.pageId).toBe(restoredPage.id);
				expect(preview.pageId).not.toBe("assistant-page");
				const [provider] = yield* session.run((db) =>
					db
						.select()
						.from(assistantTables.assistantProvider)
						.where(eq(assistantTables.assistantProvider.userId, destination)),
				);
				expect(provider).toMatchObject({
					userId: destination,
					encryptedApiKey: null,
					model: "historical-model",
					baseUrl: "https://model.example.test/v1",
				});
				expect((yield* reads.inspectRestoreTarget(destination))?.hasAssistant).toBe(true);
			}),
		testTimeout,
	);
});
