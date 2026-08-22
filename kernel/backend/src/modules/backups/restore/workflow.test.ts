import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import { sql } from "drizzle-orm";
import { Effect, FileSystem, Layer, Stream } from "effect";
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

const makeLayer = (input: {
	writer?: MockOverrides<typeof mockWriter>;
	fileSystem?: Layer.Layer<FileSystem.FileSystem>;
	repository: MockOverrides<typeof mockRepository>;
	pluginRestore?: MockOverrides<typeof mockPluginRestore>;
	cleanliness?: MockOverrides<typeof mockCleanliness>;
	uploadIntents?: MockOverrides<typeof mockUploadIntents>;
	managedAssets?: MockOverrides<typeof mockManagedAssets>;
	objectStorage?: MockOverrides<typeof mockObjectStorage>;
}) =>
	RestoreBackupWorkflowOperationsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				input.fileSystem ?? BunFileSystem.layer,
				makeAppConfigLayer({ fileStorage: { localTempDir } }),
				databaseLayer,
				mockRepository(input.repository),
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
			),
		),
	);

it.effect("replays a running restore without changing its start state", () => {
	let cleanlinessChecks = 0;
	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		expect(yield* operations.begin(payload)).toBe(true);
		expect(cleanlinessChecks).toBe(0);
	}).pipe(
		Effect.provide(
			makeLayer({
				cleanliness: {
					assertAccountIsClean: () =>
						Effect.sync(() => {
							cleanlinessChecks += 1;
							return undefined;
						}),
				},
				repository: {
					getRunById: () => Effect.succeed(runningRun),
					markRunRunning: () => Effect.die("running replay must not update the run"),
				},
			}),
		),
	);
});

it.effect("uses the restore run as the durable temporary upload claimant", () => {
	let claimId: string | undefined;
	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		expect(yield* operations.claim(payload)).toMatchObject({ intentId: "intent-id" });
		expect(claimId).toBe(runId);
	}).pipe(
		Effect.provide(
			makeLayer({
				repository: {},
				uploadIntents: {
					claimTemporaryUpload: (_token, _userId, claimant) => {
						claimId = claimant;
						return Effect.succeed({
							intentId: "intent-id",
							fileName: "archive.zip",
							leaseExpiresAt: "2026-08-23T13:00:00.000Z",
							locator: { type: "local" as const, key: "temporary/archive.zip" },
						});
					},
				},
			}),
		),
	);
});

it.effect("skips archive validation and mutation after the restore checkpoint", () =>
	Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		yield* operations.restore(payload, {
			provider: "local",
			intentId: "intent-id",
			key: "temporary/archive.zip",
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				repository: { getRunById: () => Effect.succeed({ ...runningRun, progress: 90 }) },
				writer: { restoreRecords: () => Effect.die("checkpoint replay must not restore rows") },
				objectStorage: {
					openObject: () => Effect.die("checkpoint replay must not read the archive"),
				},
			}),
		),
	),
);

it.effect("completes before best-effort temporary cleanup", () => {
	const calls: string[] = [];
	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		yield* operations.cleanup(payload, {
			provider: "local",
			intentId: "intent-id",
			key: "temporary/archive.zip",
		});
		expect(calls).toEqual(["complete", "delete", "delete", "delete"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				repository: {
					completeRun: () =>
						Effect.sync(() => {
							calls.push("complete");
							return { ...runningRun, status: "completed" as const };
						}),
				},
				uploadIntents: {
					deleteTemporaryUpload: () =>
						Effect.suspend(() => {
							calls.push("delete");
							return Effect.fail(new BadRequest({ message: "storage unavailable" }));
						}),
				},
			}),
		),
	);
});

it.effect("keeps a committed restore successful when spool cleanup fails", () => {
	const archive = createArchiveStream({
		assets: [],
		redactions: [],
		requiredPlugins: [],
		archiveId: "archive-id",
		appVersion: "backend-v1",
		createdAt: "2026-08-23T12:00:00.000Z",
		events: { count: 0, bytes: 0, chunks: [], sha256: EMPTY_SHA256 },
		records: {
			entities: [],
			savedViews: [],
			integrations: [],
			installations: [],
			relationships: [],
			privatePlugins: [],
			entityDependencies: [],
			notificationSubscriptions: [],
			profile: { image: null, name: "User", preferences: {} },
		},
	});
	const fileSystem = Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, (fs) =>
			Object.assign(Object.create(fs), { remove: () => Effect.die("spool cleanup failed") }),
		),
	).pipe(Layer.provide(BunFileSystem.layer));

	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		yield* operations.restore(payload, {
			provider: "local",
			intentId: "intent-id",
			key: "temporary/archive.zip",
		});
	}).pipe(
		Effect.provide(
			makeLayer({
				fileSystem,
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
					openObject: () =>
						Effect.succeed(
							archive.pipe(
								Stream.mapError(() => new BadRequest({ message: "archive stream failed" })),
							),
						),
				},
			}),
		),
	);
});

it.effect("stops before plugin persistence and asset staging when package preflight fails", () => {
	let staged = false;
	let persisted = false;
	const asset = new TextEncoder().encode("unstaged asset");
	const sha256 = new CryptoHasher("sha256").update(asset).digest("hex");
	const archive = createArchiveStream({
		redactions: [],
		requiredPlugins: [],
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
		records: {
			entities: [],
			savedViews: [],
			integrations: [],
			installations: [],
			relationships: [],
			privatePlugins: [],
			entityDependencies: [],
			notificationSubscriptions: [],
			profile: { image: null, name: "User", preferences: {} },
		},
	});
	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		yield* operations
			.restore(payload, { provider: "local", intentId: "intent-id", key: "temporary/archive.zip" })
			.pipe(Effect.flip);
		expect(persisted).toBe(false);
		expect(staged).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer({
				repository: { getRunById: () => Effect.succeed(runningRun) },
				writer: { assertRequiredPlugins: () => Effect.succeed(new Map()) },
				objectStorage: {
					openObject: () =>
						Effect.succeed(
							archive.pipe(
								Stream.mapError(() => new BadRequest({ message: "archive stream failed" })),
							),
						),
				},
				managedAssets: {
					stageContentAddressedPermanentAsset: () =>
						Effect.sync(() => {
							staged = true;
							return Effect.die("package failure staged an asset");
						}).pipe(Effect.flatten),
				},
				pluginRestore: {
					prepare: () => Effect.fail(new BadRequest({ message: "Plugin compilation failed" })),
					persist: () =>
						Effect.sync(() => {
							persisted = true;
							return new Map();
						}),
				},
			}),
		),
	);
});

it.effect("records a safe specific failure before best-effort temporary cleanup", () => {
	const calls: string[] = [];
	return Effect.gen(function* () {
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
			{ provider: "local", intentId: "intent-id", key: "temporary/archive.zip" },
		);
		expect(calls).toEqual(["fail:required-plugin-unavailable", "delete", "delete", "delete"]);
	}).pipe(
		Effect.provide(
			makeLayer({
				repository: {
					failRun: (input) =>
						Effect.sync(() => {
							calls.push(`fail:${input.failure.code}`);
							return { ...runningRun, status: "failed" as const };
						}),
				},
				uploadIntents: {
					deleteTemporaryUpload: () =>
						Effect.suspend(() => {
							calls.push("delete");
							return Effect.fail(new BadRequest({ message: "storage unavailable" }));
						}),
				},
			}),
		),
	);
});

it.effect("rolls back managed assets and domain rows and removes newly staged objects", () => {
	const asset = new TextEncoder().encode("restore asset");
	const sha256 = new CryptoHasher("sha256").update(asset).digest("hex");
	const objects = new Set<string>();
	const schema = `restore_rollback_${crypto.randomUUID().replaceAll("-", "")}`;
	let transactionSession: DatabaseSession["Service"];
	const createdAt = new Date(0);
	const archive = createArchiveStream({
		redactions: [],
		requiredPlugins: [],
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
		records: {
			entities: [],
			savedViews: [],
			integrations: [],
			installations: [],
			relationships: [],
			privatePlugins: [],
			entityDependencies: [],
			notificationSubscriptions: [],
			profile: { image: null, name: "User", preferences: {} },
		},
	});

	return Effect.gen(function* () {
		const session = yield* DatabaseSession;
		transactionSession = session;
		const db = yield* session.current;
		yield* db.execute(sql`create schema ${sql.identifier(schema)}`);
		yield* db.execute(
			sql`create table ${sql.identifier(schema)}.restore_row (id text primary key)`,
		);
		const operations = yield* RestoreBackupWorkflowOperations;
		const error = yield* operations
			.restore(payload, { provider: "local", intentId: "intent-id", key: "temporary/archive.zip" })
			.pipe(Effect.flip);
		expect(error.failure).toEqual({ issue: "invalid-entry", code: "archive-invalid" });
		const rows = yield* db
			.select({ id: sql<string>`id` })
			.from(sql`${sql.identifier(schema)}.restore_row`);
		expect(rows).toHaveLength(0);
		expect([...objects]).toEqual([]);
	}).pipe(
		Effect.ensuring(
			Effect.flatMap(DatabaseSession, (session) =>
				Effect.flatMap(session.current, (db) =>
					db
						.execute(sql`drop schema if exists ${sql.identifier(schema)} cascade`)
						.pipe(Effect.orDie),
				),
			),
		),
		Effect.provide(
			makeLayer({
				cleanliness: { assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)) },
				repository: {
					getRunById: () => Effect.succeed(runningRun),
					updateProgress: () => Effect.die("failed transaction must not checkpoint"),
				},
				objectStorage: {
					selectStorageProvider: () => Effect.succeed("local" as const),
					openObject: () =>
						Effect.succeed(
							archive.pipe(
								Stream.mapError(() => new BadRequest({ message: "archive stream failed" })),
							),
						),
				},
				writer: {
					assertRequiredPlugins: () => Effect.succeed(new Map()),
					restoreRecords: () =>
						Effect.gen(function* () {
							const db = yield* transactionSession.current;
							yield* db
								.execute(
									sql`insert into ${sql.identifier(schema)}.restore_row (id) values ('domain-row')`,
								)
								.pipe(Effect.orDie);
							return yield* new BadRequest({ message: "Crafted restore row is invalid" });
						}),
				},
				managedAssets: {
					registerManagedAssetInLockedTransaction: (metadata) =>
						Effect.gen(function* () {
							const db = yield* transactionSession.current;
							yield* db
								.execute(
									sql`insert into ${sql.identifier(schema)}.restore_row (id) values ('managed-asset')`,
								)
								.pipe(Effect.orDie);
							return { ...metadata, createdAt };
						}),
					cleanupStagedPermanentAsset: (staged) =>
						Effect.gen(function* () {
							const db = yield* transactionSession.current;
							const rows = yield* db
								.select({ id: sql<string>`id` })
								.from(sql`${sql.identifier(schema)}.restore_row`)
								.where(sql`id = 'managed-asset'`)
								.pipe(Effect.orDie);
							if (rows.length === 0) {
								objects.delete(staged.locator.key);
							}
						}),
					stageContentAddressedPermanentAsset: (input) => {
						const { stream, ...metadata } = input;
						return Stream.runDrain(
							stream.pipe(
								Stream.mapError(() => new BadRequest({ message: "asset stream failed" })),
							),
						).pipe(
							Effect.as({
								created: true,
								metadata: { ...metadata, key: `permanent/${input.sha256}.bin` },
								locator: { type: "local" as const, key: `permanent/${input.sha256}.bin` },
							}),
							Effect.tap(({ locator }) =>
								Effect.sync(() => {
									objects.add(locator.key);
								}),
							),
						);
					},
				},
			}),
		),
	);
});

it.effect("runs restore claim, direct writes, and cleanup without application hooks", () => {
	const calls: string[] = [];
	const workflowPayload = { runId, userId, uploadToken: "token" };
	const instance = WorkflowInstance.initial(RestoreBackupWorkflow, runId);
	const engine = makeWorkflowActivityEngine(instance);
	const layer = Layer.mergeAll(
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, engine),
		Layer.mock(RestoreBackupWorkflowOperations, {
			fail: () => Effect.sync(() => void calls.push("fail")),
			begin: () => Effect.sync(() => (calls.push("begin"), true)),
			restore: () => Effect.sync(() => void calls.push("restore")),
			cleanup: () => Effect.sync(() => void calls.push("cleanup")),
			claim: () =>
				Effect.sync(() => {
					calls.push("claim");
					return { intentId: "intent", provider: "local" as const, key: "temporary/input.zip" };
				}),
		}),
	);
	return Effect.gen(function* () {
		yield* runRestoreBackupWorkflow(workflowPayload, runId);
		expect(calls).toEqual(["begin", "claim", "restore", "cleanup"]);
	}).pipe(Effect.provide(layer));
});
