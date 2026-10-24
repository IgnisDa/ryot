import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { BadRequest, DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { CryptoHasher } from "bun";
import { eq } from "drizzle-orm";
import { Context, DateTime, Deferred, Effect, Exit, Fiber, Layer, Ref, Stream } from "effect";

import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { UploadIntentsService } from "#modules/assets/uploads/intents";
import { PluginBackupRestore } from "#modules/plugins/packages/backup-restore";
import { makeRevisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { entity } from "#schema/tables/entities";
import { eventStream, eventStreamWork } from "#schema/tables/event-streams";
import { reminder } from "#schema/tables/reminders";
import { makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream } from "../archive/archive";
import { BackupsRepository } from "../runs/repository";
import { BackupAccountCleanliness } from "./account-cleanliness";
import { BackupRestorePersistence } from "./persistence";
import {
	BackupWorkflowError,
	RestoreBackupWorkflowOperations,
	RestoreBackupWorkflowOperationsLive,
} from "./workflow";
import { BackupRestoreWriter, preflightProvenance } from "./writer";

type Scenario =
	| "success"
	| "deadlock"
	| "commit-error"
	| "write-failure"
	| "commit-deadlock"
	| "commit-interrupt"
	| "completion-rollback";

class RestoreDatabaseHarness extends Context.Service<
	RestoreDatabaseHarness,
	{
		readonly committed: Effect.Effect<void>;
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly configure: (scenario: Scenario) => Effect.Effect<void>;
	}
>()("test/RestoreDatabaseHarness") {}

const profile = {
	image: null,
	name: "Restored profile",
	preferences: {
		language: null,
		disableIntegrations: true,
		reportingTimeZone: TimeZone.make("America/New_York"),
	},
};
const restoredReminderDate = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
const archiveLocator = { intentId: "restore-intent", key: "temporary/restore.zip" };
const failure = new BackupWorkflowError({
	failure: { operation: "restore", code: "unexpected-failure" },
});

const dependencies = Layer.unwrap(
	Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const repository = yield* BackupsRepository.make;
		const persistence = yield* BackupRestorePersistence.make;
		const calls = yield* Ref.make<ReadonlyArray<string>>([]);
		const committed = yield* Deferred.make<void>();
		const scenario = yield* Ref.make<Scenario>("success");
		const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
		const transaction: DatabaseSession["Service"]["transaction"] = (work) =>
			database
				.transaction(
					work.pipe(
						Effect.tap(() =>
							Effect.gen(function* () {
								yield* record("completion-written");
								if ((yield* Ref.get(scenario)) === "completion-rollback") {
									return yield* new DbError({ message: "transaction rolled back before commit" });
								}
								return yield* Effect.void;
							}),
						),
					),
				)
				.pipe(
					Effect.tap(() =>
						Effect.gen(function* () {
							const current = yield* Ref.get(scenario);
							if (
								current === "commit-error" ||
								current === "commit-deadlock" ||
								current === "commit-interrupt"
							) {
								yield* Ref.set(scenario, "success");
								yield* record("commit-unacknowledged");
								if (current === "commit-interrupt") {
									yield* Deferred.succeed(committed, undefined);
									return yield* Effect.never;
								}
								return yield* new DbError({
									message: "commit acknowledgement lost",
									code: current === "commit-deadlock" ? "40P01" : "08006",
								});
							}
							return yield* Effect.void;
						}),
					),
				);
		return Layer.mergeAll(
			Layer.succeed(DatabaseSession, { ...database, transaction }),
			Layer.succeed(BackupsRepository, repository),
			Layer.succeed(RestoreDatabaseHarness, {
				calls: Ref.get(calls),
				committed: Deferred.await(committed),
				configure: (value) => Ref.set(scenario, value).pipe(Effect.andThen(Ref.set(calls, []))),
			}),
			Layer.mock(BackupAccountCleanliness)({
				assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)),
			}),
			Layer.mock(PluginBackupRestore)({
				lockIngestion: Effect.void,
				prepare: () => Effect.succeed([]),
				persist: () => Effect.succeed(new Map()),
				buildDefinitions: () =>
					Effect.succeed({
						savedViews: {},
						entitySchemas: {},
						signalSchemas: {},
						calendarSources: {},
						relationshipSchemas: {},
					}),
			}),
			Layer.mock(BackupRestoreWriter)({
				preflight: preflightProvenance,
				assertRequiredPlugins: () => Effect.succeed(new Map()),
				fenceEventStreamInputs: persistence.fenceEventStreamInputs,
				restoreRecords: (userId, records) =>
					Effect.gen(function* () {
						yield* record("restore");
						yield* persistence.restorePortableProfile(userId, records.profile);
						yield* persistence.restoreReminder({
							userId,
							entityId: null,
							parentEntityId: null,
							state: "needs-scheduling",
							message: "Restored reminder",
							entityTitle: "Retained target",
							createdAt: restoredReminderDate,
							updatedAt: restoredReminderDate,
							id: `${userId}-restored-reminder`,
							accountGeneration: "test-account-generation",
							originalSchedule: {
								dueAt: null,
								timezone: null,
								mayHaveSent: true,
								date: "2025-01-01",
							},
						});
						const current = yield* Ref.get(scenario);
						if (current === "write-failure") {
							return yield* new BadRequest({ message: "invalid historical row" });
						}
						if (current === "deadlock") {
							yield* Ref.set(scenario, "success");
							return yield* new DbError({ code: "40P01", message: "deadlock detected" });
						}
						return undefined;
					}),
			}),
			Layer.mock(ManagedAssetsService)({}),
			Layer.mock(UploadIntentsService)({
				deleteTemporaryUpload: () =>
					record("delete").pipe(
						Effect.andThen(Effect.fail(new BadRequest({ message: "upload storage unavailable" }))),
					),
			}),
			Layer.mock(ObjectStorageService)({
				permanentStorageProvider: Effect.succeed("local" as const),
				openObject: () =>
					record("open").pipe(
						Effect.as(
							createArchiveStream({
								assets: [],
								redactions: [],
								appVersion: "test",
								requiredPlugins: [],
								archiveId: "atomic-restore",
								createdAt: "2026-10-01T00:00:00.000Z",
								events: {
									count: 0,
									bytes: 0,
									chunks: [],
									sha256: new CryptoHasher("sha256").digest("hex"),
								},
								records: {
									profile,
									entities: [],
									reminders: [],
									savedViews: [],
									integrations: [],
									installations: [],
									relationships: [],
									privatePlugins: [],
									entityDependencies: [],
									calendarSourceOverrides: [],
									notificationSubscriptions: [],
								},
							}).pipe(Stream.mapError(() => new BadRequest({ message: "archive stream failed" }))),
						),
					),
			}),
		);
	}),
).pipe(Layer.provide(makeRevisionDatabaseLayer()));

const operationsLayer = RestoreBackupWorkflowOperationsLive.pipe(
	Layer.provideMerge(dependencies),
	Layer.provide(BunFileSystem.layer),
	Layer.provide(
		makeAppConfigLayer({
			fileStorage: {
				localTempDir: `${tmpdir()}/opencode/ryot-restore-atomic-${crypto.randomUUID()}`,
			},
		}),
	),
);

const prepare = Effect.fnUntraced(function* (scenario: Scenario) {
	const database = yield* DatabaseSession;
	const userId = UserId.make(crypto.randomUUID());
	yield* database.run((db) =>
		db
			.insert(user)
			.values({
				id: userId,
				name: "Before restore",
				email: `${userId}@example.test`,
				accountGeneration: "test-account-generation",
			}),
	);
	const repository = yield* BackupsRepository;
	const run = yield* repository.createRun({ userId, kind: "restore" });
	const payload = { userId, runId: run.id, uploadToken: "upload-token" };
	yield* database.run((db) =>
		db
			.insert(entity)
			.values({
				userId,
				name: "Bootstrap record",
				id: `${userId}-bootstrap`,
				entitySchemaSlug: "fixture",
			}),
	);
	yield* database.run((db) =>
		db
			.insert(eventStream)
			.values({
				userId,
				id: `${userId}-stream`,
				eventSchemaSlug: "fixture",
				entityId: `${userId}-bootstrap`,
			}),
	);
	yield* database.run((db) =>
		db
			.insert(eventStreamWork)
			.values({
				pluginPin: {},
				completedRevision: 0,
				id: `${userId}-stream`,
				pluginRevisionId: "retained",
				outputSchema: { fields: {} },
				processorScriptId: "retained",
				checkpoint: { cursor: "old" },
				currentJobId: "old-projection",
				inputRepairJobId: "old-success",
				accountToken: "test-account-generation",
			}),
	);
	yield* repository.markRunRunning({ ...payload, progress: 5 });
	yield* (yield* RestoreDatabaseHarness).configure(scenario);
	return payload;
});

const streamState = (userId: UserId) =>
	Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const [stream] = yield* database.run((db) =>
			db
				.select({
					revision: eventStream.revision,
					repairEpoch: eventStream.repairEpoch,
					checkpoint: eventStreamWork.checkpoint,
					currentJobId: eventStreamWork.currentJobId,
					inputRepairJobId: eventStreamWork.inputRepairJobId,
					completedRevision: eventStreamWork.completedRevision,
				})
				.from(eventStream)
				.innerJoin(eventStreamWork, eq(eventStreamWork.id, eventStream.id))
				.where(eq(eventStream.userId, userId)),
		);
		return stream;
	});

layer(operationsLayer)((test) => {
	test.effect("commits historical data and completion before unavailable cleanup or replay", () =>
		Effect.gen(function* () {
			const payload = yield* prepare("success");
			const repository = yield* BackupsRepository;
			const operations = yield* RestoreBackupWorkflowOperations;
			const database = yield* DatabaseSession;
			yield* repository.updateProgress({ ...payload, progress: 90 });
			yield* operations.restore(payload, archiveLocator);
			const [restored] = yield* database.run((db) =>
				db.select().from(user).where(eq(user.id, payload.userId)),
			);
			expect(restored).toMatchObject(profile);
			expect(yield* streamState(payload.userId)).toEqual({
				revision: 1,
				checkpoint: null,
				currentJobId: null,
				inputRepairJobId: null,
				completedRevision: null,
				repairEpoch: `restore:${payload.runId}`,
			});
			const completed = yield* repository.getRunById(payload);
			expect(completed).toMatchObject({ progress: 100, failure: null, status: "completed" });
			expect(completed?.finishedAt).toEqual(expect.any(String));
			yield* operations.cleanup(payload, archiveLocator);
			expect(yield* operations.begin(payload)).toBe(false);
			yield* operations.restore(payload, archiveLocator);
			expect((yield* streamState(payload.userId))?.revision).toBe(1);
			const restoredReminders = yield* database.run((db) =>
				db.select().from(reminder).where(eq(reminder.userId, payload.userId)),
			);
			expect(restoredReminders).toHaveLength(1);
			expect(restoredReminders[0]).toMatchObject({
				dueAt: null,
				entityId: null,
				timezone: null,
				dispatch: null,
				triggerId: null,
				reconcileAt: null,
				processingAt: null,
				parentEntityId: null,
				formatterRunId: null,
				userId: payload.userId,
				state: "needs-scheduling",
				message: "Restored reminder",
				entityTitle: "Retained target",
				createdAt: restoredReminderDate,
				updatedAt: restoredReminderDate,
				id: `${payload.userId}-restored-reminder`,
				accountGeneration: "test-account-generation",
				originalSchedule: { dueAt: null, timezone: null, mayHaveSent: true, date: "2025-01-01" },
			});
			yield* operations.fail(payload, failure);
			expect(yield* repository.getRunById(payload)).toEqual(completed);
			expect(yield* (yield* RestoreDatabaseHarness).calls).toEqual([
				"open",
				"restore",
				"completion-written",
				"delete",
				"delete",
				"delete",
			]);
		}),
	);

	for (const scenario of ["write-failure", "completion-rollback"] as const) {
		test.effect(`rolls back historical data and real run completion on ${scenario}`, () =>
			Effect.gen(function* () {
				const payload = yield* prepare(scenario);
				const operations = yield* RestoreBackupWorkflowOperations;
				yield* operations.restore(payload, archiveLocator).pipe(Effect.flip);
				const database = yield* DatabaseSession;
				const [unchanged] = yield* database.run((db) =>
					db.select().from(user).where(eq(user.id, payload.userId)),
				);
				expect(unchanged?.name).toBe("Before restore");
				expect(yield* streamState(payload.userId)).toEqual({
					revision: 0,
					completedRevision: 0,
					repairEpoch: "initial",
					checkpoint: { cursor: "old" },
					currentJobId: "old-projection",
					inputRepairJobId: "old-success",
				});
				expect(
					yield* database.run((db) =>
						db.select().from(reminder).where(eq(reminder.userId, payload.userId)),
					),
				).toHaveLength(0);
				const repository = yield* BackupsRepository;
				expect(yield* repository.getRunById(payload)).toMatchObject({
					progress: 5,
					finishedAt: null,
					status: "running",
				});
				expect(yield* (yield* RestoreDatabaseHarness).calls).toEqual(
					scenario === "write-failure"
						? ["open", "restore"]
						: ["open", "restore", "completion-written"],
				);
				yield* operations.fail(payload, failure);
				expect(yield* repository.getRunById(payload)).toMatchObject({ status: "failed" });
			}),
		);
	}

	for (const scenario of ["commit-error", "commit-deadlock"] as const) {
		test.effect(`resolves ${scenario} from completed status without retrying or failing`, () =>
			Effect.gen(function* () {
				const payload = yield* prepare(scenario);
				yield* (yield* RestoreBackupWorkflowOperations).restore(payload, archiveLocator);
				expect(yield* streamState(payload.userId)).toMatchObject({
					revision: 1,
					inputRepairJobId: null,
					repairEpoch: `restore:${payload.runId}`,
				});
				expect(yield* (yield* BackupsRepository).getRunById(payload)).toMatchObject({
					progress: 100,
					status: "completed",
				});
				const database = yield* DatabaseSession;
				const restoredReminders = yield* database.run((db) =>
					db.select().from(reminder).where(eq(reminder.userId, payload.userId)),
				);
				expect(restoredReminders).toHaveLength(1);
				expect(restoredReminders[0]).toMatchObject({
					dueAt: null,
					entityId: null,
					timezone: null,
					dispatch: null,
					triggerId: null,
					reconcileAt: null,
					processingAt: null,
					parentEntityId: null,
					formatterRunId: null,
					userId: payload.userId,
					state: "needs-scheduling",
					message: "Restored reminder",
					entityTitle: "Retained target",
					createdAt: restoredReminderDate,
					updatedAt: restoredReminderDate,
					id: `${payload.userId}-restored-reminder`,
					accountGeneration: "test-account-generation",
					originalSchedule: { dueAt: null, timezone: null, mayHaveSent: true, date: "2025-01-01" },
				});
				expect(yield* (yield* RestoreDatabaseHarness).calls).toEqual([
					"open",
					"restore",
					"completion-written",
					"commit-unacknowledged",
				]);
			}),
		);
	}

	test.effect("replays completed data after interruption between commit and acknowledgement", () =>
		Effect.gen(function* () {
			const payload = yield* prepare("commit-interrupt");
			const operations = yield* RestoreBackupWorkflowOperations;
			const fiber = yield* operations.restore(payload, archiveLocator).pipe(Effect.forkChild);
			yield* (yield* RestoreDatabaseHarness).committed;
			yield* Fiber.interrupt(fiber);
			expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
			expect(yield* (yield* BackupsRepository).getRunById(payload)).toMatchObject({
				progress: 100,
				status: "completed",
			});
			expect(yield* operations.begin(payload)).toBe(false);
			yield* operations.restore(payload, archiveLocator);
			expect(yield* streamState(payload.userId)).toMatchObject({
				revision: 1,
				inputRepairJobId: null,
				repairEpoch: `restore:${payload.runId}`,
			});
			const database = yield* DatabaseSession;
			const restoredReminders = yield* database.run((db) =>
				db.select().from(reminder).where(eq(reminder.userId, payload.userId)),
			);
			expect(restoredReminders).toHaveLength(1);
			expect(restoredReminders[0]).toMatchObject({
				dueAt: null,
				entityId: null,
				timezone: null,
				dispatch: null,
				triggerId: null,
				reconcileAt: null,
				processingAt: null,
				parentEntityId: null,
				formatterRunId: null,
				userId: payload.userId,
				state: "needs-scheduling",
				message: "Restored reminder",
				entityTitle: "Retained target",
				createdAt: restoredReminderDate,
				updatedAt: restoredReminderDate,
				id: `${payload.userId}-restored-reminder`,
				accountGeneration: "test-account-generation",
				originalSchedule: { dueAt: null, timezone: null, mayHaveSent: true, date: "2025-01-01" },
			});
			expect(yield* (yield* RestoreDatabaseHarness).calls).toEqual([
				"open",
				"restore",
				"completion-written",
				"commit-unacknowledged",
			]);
		}),
	);

	test.effect("retries a rolled-back deadlock and commits data with real completion once", () =>
		Effect.gen(function* () {
			const payload = yield* prepare("deadlock");
			yield* (yield* RestoreBackupWorkflowOperations).restore(payload, archiveLocator);
			expect(yield* (yield* BackupsRepository).getRunById(payload)).toMatchObject({
				progress: 100,
				status: "completed",
			});
			const database = yield* DatabaseSession;
			const restoredReminders = yield* database.run((db) =>
				db.select().from(reminder).where(eq(reminder.userId, payload.userId)),
			);
			expect(restoredReminders).toHaveLength(1);
			expect(restoredReminders[0]).toMatchObject({
				dueAt: null,
				entityId: null,
				timezone: null,
				dispatch: null,
				triggerId: null,
				reconcileAt: null,
				processingAt: null,
				parentEntityId: null,
				formatterRunId: null,
				userId: payload.userId,
				state: "needs-scheduling",
				message: "Restored reminder",
				entityTitle: "Retained target",
				createdAt: restoredReminderDate,
				updatedAt: restoredReminderDate,
				id: `${payload.userId}-restored-reminder`,
				accountGeneration: "test-account-generation",
				originalSchedule: { dueAt: null, timezone: null, mayHaveSent: true, date: "2025-01-01" },
			});
			expect(yield* (yield* RestoreDatabaseHarness).calls).toEqual([
				"open",
				"restore",
				"restore",
				"completion-written",
			]);
		}),
	);
});
