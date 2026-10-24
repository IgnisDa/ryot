import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { AutomationTriggerId, EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { DateTime, Effect, FileSystem, Layer, Stream } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { makeRevisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { reminderTestInput } from "#modules/reminders/reminders.test-support";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupRestorePersistence } from "./restore/persistence";
import { BackupRestoreWriter } from "./restore/writer";

const dependencies = Layer.mergeAll(
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
	Layer.provideMerge(makeRevisionDatabaseLayer()),
	Layer.provideMerge(BunFileSystem.layer),
	Layer.provide(
		Layer.mock(ManagedAssetsService, { verifyManagedAssetOwnership: () => Effect.succeed([]) }),
	),
);

layer(services)((test) => {
	test.effect(
		"round-trips authored reminders without restoring executable work or losing uncertain-send evidence",
		() =>
			Effect.gen(function* () {
				const { user, body } = yield* reminderTestInput();
				const session = yield* DatabaseSession;
				const persistence = yield* BackupRestorePersistence;
				const parentEntityId = EntityId.make(`${user.id}-parent`);
				const globalParentEntityId = EntityId.make(`${user.id}-global-parent`);
				const now = DateTime.toDate(DateTime.makeUnsafe(body.submittedAt));
				const due = DateTime.toDate(DateTime.makeUnsafe(body.dueAt));
				const triggerId = AutomationTriggerId.make("source-trigger");
				yield* session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db.insert(tables.entity).values([
								{
									name: "Parent",
									userId: user.id,
									id: parentEntityId,
									entitySchemaPluginId: null,
									entitySchemaSlug: "collection",
								},
								{
									userId: null,
									name: "Global parent",
									id: globalParentEntityId,
									entitySchemaPluginId: null,
									entitySchemaSlug: "collection",
								},
							]),
						);
						for (const state of [
							"needs-scheduling",
							"scheduled",
							"processing",
							"settled",
							"cancelled",
						] as const) {
							yield* persistence.restoreReminder({
								state,
								createdAt: now,
								updatedAt: now,
								userId: user.id,
								id: `source-${state}`,
								entityId: body.entityId,
								entityTitle: "Original title",
								message: `Exact message\n${state}`,
								accountGeneration: user.accountGeneration.token,
								outcome: state === "settled" ? "partial" : null,
								dueAt: state === "needs-scheduling" ? null : due,
								reason: state === "cancelled" ? "cancelled" : null,
								timezone: state === "needs-scheduling" ? null : "Asia/Kolkata",
								replacementId: state === "cancelled" ? "source-scheduled" : null,
								settledAt: state === "settled" || state === "cancelled" ? due : null,
								reconcileAt: state === "scheduled" || state === "processing" ? due : null,
								parentEntityId: state === "settled" ? globalParentEntityId : parentEntityId,
								originalSchedule:
									state === "needs-scheduling"
										? { dueAt: null, timezone: null, date: "2025-01-19", mayHaveSent: false }
										: null,
								...(state === "processing"
									? {
											triggerId,
											processingAt: due,
											formatterRunId: "source-run",
											dispatch: { runs: [], triggerId, blockedReason: null },
										}
									: {}),
							});
						}
					}),
				);
				const fs = yield* FileSystem.FileSystem;
				const directory = yield* fs.makeTempDirectoryScoped();
				const exported = yield* (yield* BackupExportSnapshot).prepareExportSnapshot(
					user.id,
					`${directory}/events`,
				);
				expect(exported.records.reminders).toHaveLength(5);
				expect(exported.records.reminders).toContainEqual(
					expect.objectContaining({ id: "source-cancelled", replacementId: "source-scheduled" }),
				);
				expect(exported.records.entityDependencies).toEqual([
					expect.objectContaining({
						name: "Global parent",
						id: globalParentEntityId,
						identity: { kind: "unmanaged" },
					}),
				]);
				const archive = yield* validateArchiveStream(
					createArchiveStream({
						assets: [],
						appVersion: "test",
						records: exported.records,
						createdAt: body.submittedAt,
						redactions: exported.redactions,
						archiveId: "reminder-round-trip",
						requiredPlugins: exported.requiredPlugins,
						events: {
							...exported.events,
							chunks: Stream.toAsyncIterable(fs.stream(exported.events.path)),
						},
					}),
					{ directory },
				);
				expect(archive.records.reminders).toEqual(exported.records.reminders);
				expect(archive.records.entityDependencies).toEqual(exported.records.entityDependencies);
				const destination = UserId.make("recipient");
				const definitions = yield* (yield* DefinitionRepository).getUserSnapshot(destination, {
					listed: true,
				});
				const writer = yield* BackupRestoreWriter;
				yield* session.transaction(
					writer.restoreRecords(
						destination,
						archive.records,
						new Map(),
						archive.events,
						new Map(),
						definitions,
					),
				);
				const restored = yield* session.run((db) =>
					db.select().from(tables.reminder).where(eq(tables.reminder.userId, destination)),
				);
				expect(restored).toHaveLength(5);
				const destinationEntities = yield* (yield* EntitiesRepository).listUserEntitiesForBackup(
					destination,
				);
				const target = destinationEntities.find(({ name }) => name === "Target");
				const parent = destinationEntities.find(({ name }) => name === "Parent");
				assert(target);
				assert(parent);
				expect(target.id).not.toBe(body.entityId);
				expect(parent.id).not.toBe(parentEntityId);
				for (const row of restored) {
					expect(row.entityId).toBe(target.id);
					expect(row.accountGeneration).toBe("test-account-generation");
					expect(row.id.startsWith("source-")).toBe(false);
					expect(row.dispatch).toBeNull();
					expect(row.formatterRunId).toBeNull();
					expect(row.triggerId).toBeNull();
					expect(row.reconcileAt).toBeNull();
				}
				for (const row of restored.filter(({ message }) => message !== "Exact message\nsettled")) {
					expect(row.parentEntityId).toBe(parent.id);
				}
				expect(
					restored.find((row) => row.message === "Exact message\nsettled")?.parentEntityId,
				).toBe(globalParentEntityId);
				const processing = restored.find((row) => row.message === "Exact message\nprocessing");
				expect(processing).toMatchObject({
					dueAt: null,
					timezone: null,
					state: "needs-scheduling",
					originalSchedule: { dueAt: body.dueAt, mayHaveSent: true, timezone: "Asia/Kolkata" },
				});
				expect(restored.find((row) => row.message === "Exact message\nscheduled")).toMatchObject({
					state: "needs-scheduling",
					originalSchedule: { mayHaveSent: false },
				});
				expect(
					restored.find((row) => row.message === "Exact message\nneeds-scheduling"),
				).toMatchObject({
					state: "needs-scheduling",
					originalSchedule: { dueAt: null, timezone: null, date: "2025-01-19" },
				});
				expect(restored.find((row) => row.message === "Exact message\nsettled")).toMatchObject({
					dueAt: due,
					state: "settled",
					outcome: "partial",
				});
				expect(restored.find((row) => row.message === "Exact message\ncancelled")).toMatchObject({
					state: "cancelled",
					reason: "cancelled",
				});
				const cancelled = restored.find((row) => row.message === "Exact message\ncancelled");
				const replacement = restored.find((row) => row.message === "Exact message\nscheduled");
				assert(cancelled);
				assert(replacement);
				expect(cancelled.replacementId).toBe(replacement.id);
				expect(replacement.id).not.toBe("source-scheduled");
				expect(yield* session.run((db) => db.select().from(tables.notification))).toEqual([]);
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
			}),
	);
});
