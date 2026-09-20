import { BunFileSystem } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { BadRequest, DbError } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import { sql } from "drizzle-orm";
import { Context, Effect, FileSystem, Layer, Ref, Stream } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
	type MockOverrides,
} from "#lib/test-utils/effect";
import { PluginBackupRestore } from "#modules/plugins/backup-restore";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { createArchiveStream } from "../archive/archive";
import { BackupsRepository } from "../runs/repository";
import { BackupAccountCleanliness } from "./account-cleanliness";
import {
	RestoreBackupWorkflow,
	BackupWorkflowError,
	RestoreBackupWorkflowOperations,
	RestoreBackupWorkflowOperationsLive,
	runRestoreBackupWorkflow,
} from "./workflow";
import { BackupRestoreWriter } from "./writer";

const localTempDir = "/tmp/ryot-backup-restore-tests";
const EMPTY_SHA256 = new CryptoHasher("sha256").digest("hex");
const userId = UserId.make("user-id");
const runId = BackupRunId.make("run-id");
const payload = { runId, userId, uploadToken: "upload-token" };
const runningRun = {
	id: runId,
	progress: 5,
	failure: null,
	expiresAt: null,
	finishedAt: null,
	artifactProvider: null,
	kind: "restore" as const,
	status: "running" as const,
	createdAt: "2026-08-23T12:00:00.000Z",
	startedAt: "2026-08-23T12:01:00.000Z",
};

const mockWriter = Layer.mock(BackupRestoreWriter);
const mockRepository = Layer.mock(BackupsRepository);
const mockPluginRestore = Layer.mock(PluginBackupRestore);
const mockUploadIntents = Layer.mock(UploadIntentsService);
const mockManagedAssets = Layer.mock(ManagedAssetsService);
const mockObjectStorage = Layer.mock(ObjectStorageService);
const mockCleanliness = Layer.mock(BackupAccountCleanliness);

class FakeRestoreDependencies extends Context.Service<
	FakeRestoreDependencies,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly stagedObjects: Effect.Effect<ReadonlySet<string>>;
	}
>()("test/FakeRestoreDependencies") {}

type RestoreFake = {
	readonly session: DatabaseSession["Service"];
	readonly record: (call: string) => Effect.Effect<void>;
	readonly addObject: (key: string) => Effect.Effect<void>;
	readonly removeObject: (key: string) => Effect.Effect<void>;
};

type RestoreDependencyOverrides = {
	writer?: MockOverrides<typeof mockWriter>;
	repository?: MockOverrides<typeof mockRepository>;
	pluginRestore?: MockOverrides<typeof mockPluginRestore>;
	cleanliness?: MockOverrides<typeof mockCleanliness>;
	uploadIntents?: MockOverrides<typeof mockUploadIntents>;
	managedAssets?: MockOverrides<typeof mockManagedAssets>;
	objectStorage?: MockOverrides<typeof mockObjectStorage>;
};

const makeLayer = (
	overrides: (fake: RestoreFake) => RestoreDependencyOverrides,
	fileSystem: Layer.Layer<FileSystem.FileSystem> = BunFileSystem.layer,
) =>
	RestoreBackupWorkflowOperationsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				fileSystem,
				makeAppConfigLayer({ fileStorage: { localTempDir } }),
				databaseLayer,
				Layer.unwrap(
					Effect.gen(function* () {
						const calls = yield* Ref.make<ReadonlyArray<string>>([]);
						const objects = yield* Ref.make<ReadonlySet<string>>(new Set());
						const input = overrides({
							session: yield* DatabaseSession,
							record: (call) => Ref.update(calls, (all) => [...all, call]),
							addObject: (key) => Ref.update(objects, (all) => new Set(all).add(key)),
							removeObject: (key) =>
								Ref.update(objects, (all) => {
									const next = new Set(all);
									next.delete(key);
									return next;
								}),
						});
						return Layer.mergeAll(
							Layer.succeed(FakeRestoreDependencies, {
								calls: Ref.get(calls),
								stagedObjects: Ref.get(objects),
							}),
							mockRepository(input.repository ?? {}),
							mockWriter(input.writer ?? {}),
							mockCleanliness(input.cleanliness ?? {}),
							mockUploadIntents(input.uploadIntents ?? {}),
							mockManagedAssets(input.managedAssets ?? {}),
							mockObjectStorage(input.objectStorage ?? {}),
							mockPluginRestore({
								prepare: () => Effect.succeed([]),
								persist: () => Effect.succeed(new Map()),
								buildDefinitions: () =>
									Effect.succeed({
										savedViews: {},
										entitySchemas: {},
										signalSchemas: {},
										relationshipSchemas: {},
									}),
								...input.pluginRestore,
							}),
						);
					}),
				).pipe(Layer.provide(databaseLayer)),
			),
		),
	);

const archiveLocator = {
	intentId: "intent-id",
	provider: "local" as const,
	key: "temporary/archive.zip",
};

const emptyRecords = {
	entities: [],
	savedViews: [],
	integrations: [],
	installations: [],
	relationships: [],
	privatePlugins: [],
	entityDependencies: [],
	notificationSubscriptions: [],
	profile: { image: null, name: "User", preferences: {} },
};

const archiveWithAsset = (asset: Uint8Array) => {
	const sha256 = new CryptoHasher("sha256").update(asset).digest("hex");
	return createArchiveStream({
		redactions: [],
		requiredPlugins: [],
		records: emptyRecords,
		archiveId: "archive-id",
		appVersion: "backend-v1",
		createdAt: "2026-08-23T12:00:00.000Z",
		events: { count: 0, bytes: 0, chunks: [], sha256: EMPTY_SHA256 },
		assets: [
			{
				chunks: [asset],
				metadata: {
					sha256,
					size: asset.byteLength,
					path: `assets/${sha256}`,
					contentType: "application/octet-stream",
				},
			},
		],
	});
};

const openArchive = (archive: ReturnType<typeof createArchiveStream>) => () =>
	Effect.succeed(
		archive.pipe(Stream.mapError(() => new BadRequest({ message: "archive stream failed" }))),
	);

layer(
	makeLayer(({ record }) => ({
		cleanliness: { assertAccountIsClean: () => record("cleanliness").pipe(Effect.as(undefined)) },
		repository: {
			getRunById: () => Effect.succeed(runningRun),
			markRunRunning: () => Effect.die("running replay must not update the run"),
		},
	})),
)((test) => {
	test.effect("replays a running restore without changing its start state", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			expect(yield* operations.begin(payload)).toBe(true);
			expect(
				(yield* (yield* FakeRestoreDependencies).calls).filter((call) => call === "cleanliness"),
			).toHaveLength(0);
		}),
	);
});

layer(
	makeLayer(({ record }) => ({
		uploadIntents: {
			claimTemporaryUpload: (_token, _userId, claimant) =>
				record(`claimant:${claimant}`).pipe(
					Effect.as({
						intentId: "intent-id",
						fileName: "archive.zip",
						leaseExpiresAt: "2026-08-23T13:00:00.000Z",
						locator: { type: "local" as const, key: "temporary/archive.zip" },
					}),
				),
		},
	})),
)((test) => {
	test.effect("uses the restore run as the durable temporary upload claimant", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			expect(yield* operations.claim(payload)).toMatchObject({ intentId: "intent-id" });
			expect((yield* (yield* FakeRestoreDependencies).calls).at(-1)).toBe(`claimant:${runId}`);
		}),
	);
});

layer(
	makeLayer(() => ({
		repository: { getRunById: () => Effect.succeed({ ...runningRun, progress: 90 }) },
		writer: { restoreRecords: () => Effect.die("checkpoint replay must not restore rows") },
		objectStorage: { openObject: () => Effect.die("checkpoint replay must not read the archive") },
	})),
)((test) => {
	test.effect("skips archive validation and mutation after the restore checkpoint", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			yield* operations.restore(payload, archiveLocator);
		}),
	);
});

layer(
	makeLayer(({ record }) => ({
		repository: {
			completeRun: () =>
				record("complete").pipe(Effect.as({ ...runningRun, status: "completed" as const })),
		},
		uploadIntents: {
			deleteTemporaryUpload: () =>
				record("delete").pipe(
					Effect.andThen(Effect.fail(new BadRequest({ message: "storage unavailable" }))),
				),
		},
	})),
)((test) => {
	test.effect("completes before best-effort temporary cleanup", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			yield* operations.cleanup(payload, archiveLocator);
			expect(yield* (yield* FakeRestoreDependencies).calls).toEqual([
				"complete",
				"delete",
				"delete",
				"delete",
			]);
		}),
	);
});

const failingSpoolCleanupFileSystem = Layer.effect(
	FileSystem.FileSystem,
	Effect.map(FileSystem.FileSystem, (fs) =>
		Object.assign(Object.create(fs), { remove: () => Effect.die("spool cleanup failed") }),
	),
).pipe(Layer.provide(BunFileSystem.layer));

layer(
	makeLayer(
		() => ({
			cleanliness: { assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)) },
			writer: {
				assertRequiredPlugins: () => Effect.succeed(new Map()),
				restoreRecords: () => Effect.void.pipe(Effect.as(undefined)),
			},
			repository: {
				getRunById: () => Effect.succeed(runningRun),
				updateProgress: () => Effect.succeed({ ...runningRun, progress: 90 }),
			},
			objectStorage: {
				selectStorageProvider: () => Effect.succeed("local" as const),
				openObject: openArchive(
					createArchiveStream({
						assets: [],
						redactions: [],
						requiredPlugins: [],
						records: emptyRecords,
						archiveId: "archive-id",
						appVersion: "backend-v1",
						createdAt: "2026-08-23T12:00:00.000Z",
						events: { count: 0, bytes: 0, chunks: [], sha256: EMPTY_SHA256 },
					}),
				),
			},
		}),
		failingSpoolCleanupFileSystem,
	),
)((test) => {
	test.effect("keeps a committed restore successful when spool cleanup fails", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			yield* operations.restore(payload, archiveLocator);
		}),
	);
});

layer(
	makeLayer(({ record }) => {
		let attempts = 0;
		return {
			cleanliness: { assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)) },
			repository: {
				getRunById: () => Effect.succeed(runningRun),
				updateProgress: () => Effect.succeed({ ...runningRun, progress: 90 }),
			},
			writer: {
				assertRequiredPlugins: () => Effect.succeed(new Map()),
				restoreRecords: () =>
					Effect.gen(function* () {
						yield* record("restore");
						if (++attempts === 1) {
							return yield* new DbError({ code: "40P01", message: "deadlock detected" });
						}
						return undefined;
					}),
			},
			objectStorage: {
				selectStorageProvider: () => Effect.succeed("local" as const),
				openObject: openArchive(
					createArchiveStream({
						assets: [],
						redactions: [],
						requiredPlugins: [],
						records: emptyRecords,
						archiveId: "archive-id",
						appVersion: "backend-v1",
						createdAt: "2026-08-23T12:00:00.000Z",
						events: { count: 0, bytes: 0, chunks: [], sha256: EMPTY_SHA256 },
					}),
				),
			},
		};
	}),
)((test) => {
	test.effect("retries a deadlocked restore transaction", () =>
		Effect.gen(function* () {
			yield* (yield* RestoreBackupWorkflowOperations).restore(payload, archiveLocator);
			expect(yield* (yield* FakeRestoreDependencies).calls).toEqual(["restore", "restore"]);
		}),
	);
});

layer(
	makeLayer(({ record }) => ({
		repository: { getRunById: () => Effect.succeed(runningRun) },
		writer: { assertRequiredPlugins: () => Effect.succeed(new Map()) },
		objectStorage: {
			openObject: openArchive(archiveWithAsset(new TextEncoder().encode("unstaged asset"))),
		},
		managedAssets: {
			stageContentAddressedPermanentAsset: () =>
				record("stage").pipe(Effect.andThen(Effect.die("package failure staged an asset"))),
		},
		pluginRestore: {
			persist: () => record("persist").pipe(Effect.as(new Map())),
			prepare: () => Effect.fail(new BadRequest({ message: "Plugin compilation failed" })),
		},
	})),
)((test) => {
	test.effect(
		"stops before plugin persistence and asset staging when package preflight fails",
		() =>
			Effect.gen(function* () {
				const operations = yield* RestoreBackupWorkflowOperations;
				yield* operations.restore(payload, archiveLocator).pipe(Effect.flip);
				const calls = yield* (yield* FakeRestoreDependencies).calls;
				expect(calls).not.toContain("persist");
				expect(calls).not.toContain("stage");
			}),
	);
});

layer(
	makeLayer(({ record }) => ({
		repository: {
			failRun: (input) =>
				record(`fail:${input.failure.code}`).pipe(
					Effect.as({ ...runningRun, status: "failed" as const }),
				),
		},
		uploadIntents: {
			deleteTemporaryUpload: () =>
				record("delete").pipe(
					Effect.andThen(Effect.fail(new BadRequest({ message: "storage unavailable" }))),
				),
		},
	})),
)((test) => {
	test.effect("records a safe specific failure before best-effort temporary cleanup", () =>
		Effect.gen(function* () {
			const operations = yield* RestoreBackupWorkflowOperations;
			yield* operations.fail(
				payload,
				new BackupWorkflowError({
					failure: {
						requiredVersion: "2",
						pluginSlug: "fixture",
						code: "required-plugin-unavailable",
					},
				}),
				archiveLocator,
			);
			expect(yield* (yield* FakeRestoreDependencies).calls).toEqual([
				"fail:required-plugin-unavailable",
				"delete",
				"delete",
				"delete",
			]);
		}),
	);
});

const rollbackSchema = `restore_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
const rollbackCreatedAt = new Date(0);

layer(
	makeLayer(({ session, addObject, removeObject }) => ({
		cleanliness: { assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)) },
		repository: {
			getRunById: () => Effect.succeed(runningRun),
			updateProgress: () => Effect.die("failed transaction must not checkpoint"),
		},
		objectStorage: {
			selectStorageProvider: () => Effect.succeed("local" as const),
			openObject: openArchive(archiveWithAsset(new TextEncoder().encode("restore asset"))),
		},
		writer: {
			assertRequiredPlugins: () => Effect.succeed(new Map()),
			restoreRecords: () =>
				session.run((db) =>
					Effect.gen(function* () {
						yield* db
							.execute(
								sql`insert into ${sql.identifier(rollbackSchema)}.restore_row (id) values ('domain-row')`,
							)
							.pipe(Effect.orDie);
						return yield* new BadRequest({ message: "Crafted restore row is invalid" });
					}),
				),
		},
		managedAssets: {
			registerManagedAssetInLockedTransaction: (metadata) =>
				session.run((db) =>
					db
						.execute(
							sql`insert into ${sql.identifier(rollbackSchema)}.restore_row (id) values ('managed-asset')`,
						)
						.pipe(Effect.orDie, Effect.as({ ...metadata, createdAt: rollbackCreatedAt })),
				),
			cleanupStagedPermanentAsset: (staged) =>
				Effect.gen(function* () {
					const rows = yield* session.run((db) =>
						db
							.select({ id: sql<string>`id` })
							.from(sql`${sql.identifier(rollbackSchema)}.restore_row`)
							.where(sql`id = 'managed-asset'`)
							.pipe(Effect.orDie),
					);
					if (rows.length === 0) {
						yield* removeObject(staged.locator.key);
					}
				}),
			stageContentAddressedPermanentAsset: (input) => {
				const { stream, ...metadata } = input;
				return Stream.runDrain(
					stream.pipe(Stream.mapError(() => new BadRequest({ message: "asset stream failed" }))),
				).pipe(
					Effect.as({
						created: true,
						metadata: { ...metadata, key: `permanent/${input.sha256}.bin` },
						locator: { type: "local" as const, key: `permanent/${input.sha256}.bin` },
					}),
					Effect.tap(({ locator }) => addObject(locator.key)),
				);
			},
		},
	})),
)((test) => {
	test.effect("rolls back managed assets and domain rows and removes newly staged objects", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) => db.execute(sql`create schema ${sql.identifier(rollbackSchema)}`));
			yield* session.run((db) =>
				db.execute(
					sql`create table ${sql.identifier(rollbackSchema)}.restore_row (id text primary key)`,
				),
			);
			const operations = yield* RestoreBackupWorkflowOperations;
			const error = yield* operations.restore(payload, archiveLocator).pipe(Effect.flip);
			expect(error.failure).toEqual({ issue: "invalid-entry", code: "archive-invalid" });
			const rows = yield* session.run((db) =>
				db.select({ id: sql<string>`id` }).from(sql`${sql.identifier(rollbackSchema)}.restore_row`),
			);
			expect(rows).toHaveLength(0);
			expect([...(yield* (yield* FakeRestoreDependencies).stagedObjects)]).toEqual([]);
		}).pipe(
			Effect.ensuring(
				Effect.flatMap(DatabaseSession, (session) =>
					session.run((db) =>
						db
							.execute(sql`drop schema if exists ${sql.identifier(rollbackSchema)} cascade`)
							.pipe(Effect.orDie),
					),
				),
			),
		),
	);
});

class FakeRestoreOperations extends Context.Service<
	FakeRestoreOperations,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("test/FakeRestoreOperations") {}

const restoreInstance = WorkflowInstance.initial(RestoreBackupWorkflow, runId);

const recordingOperationsLayer = Layer.mergeAll(
	Layer.succeed(WorkflowInstance, restoreInstance),
	Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(restoreInstance)),
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
			return Layer.merge(
				Layer.succeed(FakeRestoreOperations, { calls: Ref.get(calls) }),
				Layer.mock(RestoreBackupWorkflowOperations, {
					fail: () => record("fail"),
					restore: () => record("restore"),
					cleanup: () => record("cleanup"),
					begin: () => record("begin").pipe(Effect.as(true)),
					claim: () =>
						record("claim").pipe(
							Effect.as({
								intentId: "intent",
								provider: "local" as const,
								key: "temporary/input.zip",
							}),
						),
				}),
			);
		}),
	),
);

layer(recordingOperationsLayer)((test) => {
	test.effect("runs restore claim, direct writes, and cleanup without application hooks", () =>
		Effect.gen(function* () {
			yield* runRestoreBackupWorkflow({ runId, userId, uploadToken: "token" }, runId);
			expect(yield* (yield* FakeRestoreOperations).calls).toEqual([
				"begin",
				"claim",
				"restore",
				"cleanup",
			]);
		}),
	);
});
