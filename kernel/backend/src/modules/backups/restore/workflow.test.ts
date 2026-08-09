import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { BadRequest } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { CryptoHasher } from "bun";
import { Effect, FileSystem, Layer, Stream } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import {
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
	type MockOverrides,
} from "#lib/test-utils/effect";
import { PluginBackupRestore } from "#modules/plugins/backup-restore";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { createV2ArchiveStream } from "../archive-v2/archive";
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
	database?: object;
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
		Layer.provide(
			Layer.mergeAll(
				input.fileSystem ?? BunFileSystem.layer,
				makeAppConfigLayer({ fileStorage: { localTempDir } }),
				Layer.succeed(Database, Object.assign(Object.create(null), input.database ?? {})),
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
				repository: {
					getRunById: () => Effect.succeed(runningRun),
					markRunRunning: () => Effect.die("running replay must not update the run"),
				},
				cleanliness: {
					assertAccountIsClean: () =>
						Effect.sync(() => {
							cleanlinessChecks += 1;
							return undefined;
						}),
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
	let committed = false;
	const archive = createV2ArchiveStream({
		assets: [],
		redactions: [],
		requiredPlugins: [],
		archiveId: "archive-id",
		appVersion: "backend-v2",
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
			profile: { name: "User", image: null, preferences: {} },
		},
	});
	const fileSystem = Layer.effect(
		FileSystem.FileSystem,
		Effect.map(FileSystem.FileSystem, (fs) =>
			Object.assign(Object.create(fs), {
				remove: () => Effect.die("spool cleanup failed"),
			}),
		),
	).pipe(Layer.provide(BunFileSystem.layer));

	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		yield* operations.restore(payload, {
			provider: "local",
			intentId: "intent-id",
			key: "temporary/archive.zip",
		});
		expect(committed).toBe(true);
	}).pipe(
		Effect.provide(
			makeLayer({
				fileSystem,
				database: {
					transaction: (run: (transaction: object) => Effect.Effect<void, unknown, unknown>) =>
						run(Object.assign(Object.create(null), { execute: () => Effect.void })).pipe(
							Effect.tap(() => Effect.sync(() => void (committed = true))),
						),
				},
				repository: {
					getRunById: () => Effect.succeed(runningRun),
					updateProgress: () => Effect.succeed({ ...runningRun, progress: 90 }),
				},
				cleanliness: {
					assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)),
				},
				writer: {
					assertRequiredPlugins: () => Effect.succeed(new Map()),
					restoreRecords: () => Effect.void.pipe(Effect.as(undefined)),
				},
				objectStorage: {
					openObject: () =>
						Effect.succeed(
							archive.pipe(
								Stream.mapError(() => new BadRequest({ message: "archive stream failed" })),
							),
						),
					selectStorageProvider: () => Effect.succeed("local" as const),
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
	const archive = createV2ArchiveStream({
		redactions: [],
		requiredPlugins: [],
		archiveId: "archive-id",
		appVersion: "backend-v2",
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
			profile: { name: "User", image: null, preferences: {} },
		},
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
				database: { transaction: () => Effect.die("preflight failure reached persistence") },
				repository: { getRunById: () => Effect.succeed(runningRun) },
				writer: { assertRequiredPlugins: () => Effect.succeed(new Map()) },
				pluginRestore: {
					prepare: () => Effect.fail(new BadRequest({ message: "Plugin compilation failed" })),
					persist: () =>
						Effect.sync(() => {
							persisted = true;
							return new Map();
						}),
				},
				managedAssets: {
					stageContentAddressedPermanentAsset: () =>
						Effect.sync(() => {
							staged = true;
							return Effect.die("package failure staged an asset");
						}).pipe(Effect.flatten),
				},
				objectStorage: {
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
			{ intentId: "intent-id", provider: "local", key: "temporary/archive.zip" },
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
	const managedAssets = new Set<string>();
	const domainRows = new Set<string>();
	const createdAt = new Date(0);
	const archive = createV2ArchiveStream({
		redactions: [],
		requiredPlugins: [],
		archiveId: "archive-id",
		appVersion: "backend-v2",
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
			profile: { name: "User", image: null, preferences: {} },
		},
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
	const database = {
		transaction: (run: (transaction: object) => Effect.Effect<unknown, unknown, unknown>) => {
			const managedSnapshot = new Set(managedAssets);
			const domainSnapshot = new Set(domainRows);
			return run(Object.assign(Object.create(null), { execute: () => Effect.void })).pipe(
				Effect.tapError(() =>
					Effect.sync(() => {
						managedAssets.clear();
						domainRows.clear();
						for (const value of managedSnapshot) {
							managedAssets.add(value);
						}
						for (const value of domainSnapshot) {
							domainRows.add(value);
						}
					}),
				),
			);
		},
	};

	return Effect.gen(function* () {
		const operations = yield* RestoreBackupWorkflowOperations;
		const error = yield* operations
			.restore(payload, { provider: "local", intentId: "intent-id", key: "temporary/archive.zip" })
			.pipe(Effect.flip);
		expect(error.failure).toEqual({ code: "archive-invalid", issue: "invalid-entry" });
		expect([...managedAssets]).toEqual([]);
		expect([...domainRows]).toEqual([]);
		expect([...objects]).toEqual([]);
	}).pipe(
		Effect.provide(
			makeLayer({
				database,
				cleanliness: {
					assertAccountIsClean: () => Effect.void.pipe(Effect.as(undefined)),
				},
				repository: {
					getRunById: () => Effect.succeed(runningRun),
					updateProgress: () => Effect.die("failed transaction must not checkpoint"),
				},
				writer: {
					assertRequiredPlugins: () => Effect.succeed(new Map()),
					restoreRecords: () =>
						Effect.sync(() => domainRows.add("domain-row")).pipe(
							Effect.andThen(
								Effect.fail(new BadRequest({ message: "Crafted restore row is invalid" })),
							),
						),
				},
				objectStorage: {
					openObject: () =>
						Effect.succeed(
							archive.pipe(
								Stream.mapError(() => new BadRequest({ message: "archive stream failed" })),
							),
						),
					selectStorageProvider: () => Effect.succeed("local" as const),
				},
				managedAssets: {
					stageContentAddressedPermanentAsset: (input) => {
						const { stream, ...metadata } = input;
						return Stream.runDrain(stream).pipe(
							Effect.mapError(() => new BadRequest({ message: "asset stream failed" })),
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
					registerManagedAssetInLockedTransaction: (metadata) =>
						Effect.sync(() => {
							managedAssets.add(metadata.key);
							return { ...metadata, createdAt };
						}),
					cleanupStagedPermanentAsset: (staged) =>
						Effect.sync(() => {
							if (!managedAssets.has(staged.locator.key)) {
								objects.delete(staged.locator.key);
							}
						}),
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
			begin: () => Effect.sync(() => (calls.push("begin"), true)),
			claim: () =>
				Effect.sync(() => {
					calls.push("claim");
					return { intentId: "intent", provider: "local" as const, key: "temporary/input.zip" };
				}),
			restore: () => Effect.sync(() => void calls.push("restore")),
			cleanup: () => Effect.sync(() => void calls.push("cleanup")),
			fail: () => Effect.sync(() => void calls.push("fail")),
		}),
	);
	return Effect.gen(function* () {
		yield* runRestoreBackupWorkflow(workflowPayload, runId);
		expect(calls).toEqual(["begin", "claim", "restore", "cleanup"]);
	}).pipe(Effect.provide(layer));
});
