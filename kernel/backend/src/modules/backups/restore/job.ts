import { BadRequest, DbError, internalError } from "@ryot-app/contract/errors";
import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	BackupBadRequest,
	BackupConflict,
	BackupRunFailure,
	type BackupRunFailure as BackupRunFailureValue,
} from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Duration, Effect, FileSystem, Layer, Result, Schedule, Schema } from "effect";

import {
	ManagedAssetsService,
	type StagedPermanentAsset,
} from "#modules/assets/storage/managed-assets";
import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { UploadIntentsService } from "#modules/assets/uploads/intents";
import { PluginBackupRestore } from "#modules/plugins/packages/backup-restore";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { validateArchiveStream } from "../archive/archive";
import { archiveFailure, BackupArchiveError } from "../archive/error";
import { BackupsRepository } from "../runs/repository";
import { BackupStaging } from "../staging";
import { BackupAccountCleanliness } from "./account-cleanliness";
import { BackupRestoreWriter, RequiredBackupPluginUnavailable } from "./writer";

const RestoreBackupPayload = Schema.Struct({
	userId: UserId,
	runId: BackupRunId,
	uploadToken: Schema.String,
});
type RestoreBackupPayload = typeof RestoreBackupPayload.Type;

const ClaimedArchive = Schema.Struct({ key: Schema.String, intentId: Schema.String });
type ClaimedArchive = typeof ClaimedArchive.Type;

export class BackupRestoreError extends Schema.TaggedError<
	BackupRestoreError,
	{ readonly brand: unique symbol }
>()("BackupRestoreError", { failure: BackupRunFailure }) {}

export const RestoreBackupJob = makeJobKind("backup-restore", {
	maxAttempts: 3,
	lease: Duration.minutes(5),
	payload: RestoreBackupPayload,
});

const restoreFailure = (error: unknown): BackupRunFailureValue => {
	if (error instanceof BackupArchiveError) {
		return archiveFailure(error);
	}
	if (error instanceof RequiredBackupPluginUnavailable) {
		return {
			packageId: error.packageId,
			code: "required-plugin-unavailable",
			requiredVersion: error.requiredVersion,
		};
	}
	if (error instanceof BackupConflict && error.reason.code === "account-not-clean") {
		return error.reason;
	}
	if (
		error instanceof BadRequest ||
		(error instanceof BackupBadRequest && error.reason.code === "asset-forbidden")
	) {
		return { issue: "invalid-entry", code: "archive-invalid" };
	}
	return { operation: "restore", code: "unexpected-failure" };
};

const asRestoreError = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	failure: BackupRunFailureValue,
	classify: (error: E) => BackupRunFailureValue = () => failure,
) =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError("backup restore operation failed", error)),
		Effect.mapError((error) => new BackupRestoreError({ failure: classify(error) })),
		Effect.catchDefect((defect) =>
			Effect.logError("backup restore operation defect", defect).pipe(
				Effect.andThen(Effect.fail(new BackupRestoreError({ failure }))),
			),
		),
	);

type RestoreBackupOperationsValue = {
	begin: (payload: RestoreBackupPayload) => Effect.Effect<boolean, BackupRestoreError>;
	claim: (payload: RestoreBackupPayload) => Effect.Effect<ClaimedArchive, BackupRestoreError>;
	restore: (
		payload: RestoreBackupPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, BackupRestoreError>;
	cleanup: (
		payload: RestoreBackupPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, BackupRestoreError>;
	fail: (
		payload: RestoreBackupPayload,
		error: BackupRestoreError,
		archive?: ClaimedArchive,
	) => Effect.Effect<void, BackupRestoreError>;
};

export class RestoreBackupOperations extends Context.Service<
	RestoreBackupOperations,
	RestoreBackupOperationsValue
>()("@ryot-app/kernel-backend/modules/backups/restore/job/RestoreBackupOperations") {}

export const RestoreBackupOperationsLive = Layer.effect(
	RestoreBackupOperations,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const database = yield* DatabaseSession;
		const fs = yield* FileSystem.FileSystem;
		const writer = yield* BackupRestoreWriter;
		const staging = yield* BackupStaging;
		const repository = yield* BackupsRepository;
		const pluginRestore = yield* PluginBackupRestore;
		const uploadIntents = yield* UploadIntentsService;
		const managedAssets = yield* ManagedAssetsService;
		const objectStorage = yield* ObjectStorageService;
		const cleanliness = yield* BackupAccountCleanliness;

		const begin = (payload: RestoreBackupPayload) =>
			asRestoreError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (run?.kind !== "restore" || run.status === "failed") {
						return yield* internalError("Backup restore run is unavailable");
					}
					if (run.status === "completed") {
						return false;
					}
					if (run.status === "running") {
						return true;
					}
					yield* cleanliness.assertAccountIsClean(payload.userId);
					if (!(yield* repository.markRunRunning({ ...payload, progress: 5 }))) {
						return yield* internalError("Backup restore run could not start");
					}
					return true;
				}),
				{ operation: "restore", code: "unexpected-failure" },
				restoreFailure,
			);

		const claim = (payload: RestoreBackupPayload) =>
			asRestoreError(
				uploadIntents
					.claimTemporaryUpload(payload.uploadToken, payload.userId, payload.runId)
					.pipe(Effect.map(({ locator, intentId }) => ({ intentId, key: locator.key }))),
				{ code: "upload-unavailable" },
			);

		const restore = (payload: RestoreBackupPayload, archive: ClaimedArchive) =>
			asRestoreError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (!run) {
						return yield* internalError("Backup restore run is unavailable");
					}
					if (run.status === "completed") {
						return yield* Effect.void;
					}
					yield* staging.recoverAbandoned();
					yield* staging.begin(payload.runId);
					yield* Effect.addFinalizer(() =>
						staging
							.cleanup(payload.runId)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.logWarning("backup restore staging cleanup failed", cause).pipe(
										Effect.annotateLogs({ runId: payload.runId }),
									),
								),
							),
					);
					const source = yield* objectStorage.openObject({ type: "local", key: archive.key });
					const validated = yield* validateArchiveStream(source, {
						directory: config.fileStorage.localTempDir,
					}).pipe(Effect.provideService(FileSystem.FileSystem, fs));
					const stagedBySha = new Map<string, StagedPermanentAsset>();
					const stageAndRestore = Effect.fnUntraced(function* () {
						const systemPluginIds = yield* writer.assertRequiredPlugins(
							validated.manifest.requiredPlugins,
						);
						const preparedPlugins = yield* pluginRestore.prepare(validated.records.privatePlugins);
						const preflightPluginIds = new Map(systemPluginIds);
						for (const plugin of preparedPlugins) {
							preflightPluginIds.set(plugin.key, plugin.key);
						}
						const preflightDefinitions = yield* pluginRestore.buildDefinitions(
							preparedPlugins,
							preflightPluginIds,
						);
						yield* writer.stageArchive(
							payload.runId,
							validated.records,
							validated.sections,
							preflightPluginIds,
							preflightDefinitions,
						);
						yield* writer.preflightArchive(
							payload.runId,
							validated.records,
							preflightPluginIds,
							preflightDefinitions,
							validated.manifest.requiredPlugins,
						);
						const provider = yield* objectStorage.permanentStorageProvider;
						for (const asset of validated.assets) {
							if (stagedBySha.has(asset.sha256)) {
								continue;
							}
							const staged = yield* managedAssets.stageContentAddressedPermanentAsset({
								provider,
								size: asset.size,
								sha256: asset.sha256,
								stream: asset.stream,
								ownerUserId: payload.userId,
								contentType: asset.contentType,
							});
							stagedBySha.set(asset.sha256, staged);
						}
						const assetLocators = new Map<string, AssetLocator>();
						for (const [sha256, staged] of stagedBySha) {
							assetLocators.set(`local:${sha256}`, staged.locator);
							assetLocators.set(`s3:${sha256}`, staged.locator);
						}
						const restoreTransaction = Effect.fnUntraced(function* () {
							yield* pluginRestore.lockIngestionForUser(payload.userId);
							yield* database.acquireUserWriteLock(payload.userId);
							const currentRun = yield* repository.getRunById(payload);
							if (currentRun?.status === "completed") {
								return yield* Effect.void;
							}
							yield* cleanliness.assertAccountIsClean(payload.userId);
							const pluginIdByKey = new Map(
								yield* writer.assertRequiredPlugins(validated.manifest.requiredPlugins),
							);
							const privatePluginIds = yield* pluginRestore.persist(
								payload.userId,
								preparedPlugins,
							);
							for (const [key, id] of privatePluginIds) {
								pluginIdByKey.set(key, id);
							}
							const definitions = yield* pluginRestore.buildDefinitions(
								preparedPlugins,
								pluginIdByKey,
							);
							yield* writer.preflightArchive(
								payload.runId,
								validated.records,
								pluginIdByKey,
								definitions,
								validated.manifest.requiredPlugins,
							);
							for (const staged of stagedBySha.values()) {
								yield* managedAssets.registerManagedAssetInLockedTransaction(staged.metadata);
							}
							yield* writer.restoreArchive(
								payload.userId,
								payload.runId,
								validated.records,
								pluginIdByKey,
								definitions,
								assetLocators,
							);
							if (!(yield* repository.completeRun(payload))) {
								return yield* internalError("Backup restore could not be completed");
							}
							return yield* Effect.void;
						});
						yield* database.transaction(restoreTransaction()).pipe(
							Effect.catchCause((cause) =>
								Effect.gen(function* () {
									const committed = yield* repository.getRunById(payload);
									if (committed?.status !== "completed") {
										return yield* Effect.failCause(cause);
									}
									return yield* Effect.void;
								}),
							),
							Effect.retry({
								times: 2,
								while: (error) =>
									error instanceof DbError && (error.code === "40001" || error.code === "40P01"),
							}),
						);
					});
					yield* stageAndRestore().pipe(
						Effect.catchCause((cause) =>
							Effect.forEach(
								stagedBySha.values(),
								(staged) => managedAssets.cleanupStagedPermanentAsset(staged).pipe(Effect.ignore),
								{ discard: true },
							).pipe(Effect.andThen(Effect.failCause(cause))),
						),
					);
					return yield* Effect.void;
				}).pipe(Effect.scoped, Effect.annotateLogs({ runId: payload.runId })),
				{ operation: "restore", code: "unexpected-failure" },
				restoreFailure,
			);

		const cleanup = (payload: RestoreBackupPayload, archive: ClaimedArchive) =>
			asRestoreError(
				Effect.gen(function* () {
					yield* uploadIntents.deleteTemporaryUpload(archive.intentId).pipe(
						Effect.retry(Schedule.recurs(2)),
						Effect.catchCause((cause) =>
							Effect.logWarning("backup restore temporary upload cleanup failed", cause).pipe(
								Effect.annotateLogs({ runId: payload.runId }),
							),
						),
					);
					return yield* Effect.void;
				}),
				{ operation: "restore", code: "unexpected-failure" },
			);

		const fail = (
			payload: RestoreBackupPayload,
			error: BackupRestoreError,
			archive?: ClaimedArchive,
		) =>
			asRestoreError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (run?.status !== "completed") {
						yield* repository.failRun({ ...payload, failure: error.failure });
					}
					if (archive) {
						yield* uploadIntents
							.deleteTemporaryUpload(archive.intentId)
							.pipe(Effect.retry(Schedule.recurs(2)), Effect.ignore);
					}
				}),
				{ operation: "restore", code: "unexpected-failure" },
			);

		return { fail, claim, begin, restore, cleanup } satisfies RestoreBackupOperationsValue;
	}),
);

// A failed step settles the run itself; only a lost process makes the job retry, and the steps are
// idempotent so the retry resumes the run.
export const runRestoreBackupJob = Effect.fn("RestoreBackupJob")(
	function* (payload: RestoreBackupPayload, job: JobContext) {
		yield* Effect.annotateCurrentSpan({
			jobId: job.id,
			runId: payload.runId,
			userId: payload.userId,
		});
		const operations = yield* RestoreBackupOperations;
		const started = yield* Effect.result(operations.begin(payload));
		if (Result.isFailure(started)) {
			yield* operations.fail(payload, started.failure);
			return;
		}
		if (!started.success) {
			return;
		}
		const claimed = yield* Effect.result(operations.claim(payload));
		if (Result.isFailure(claimed)) {
			yield* operations.fail(payload, claimed.failure);
			return;
		}
		const restored = yield* Effect.result(operations.restore(payload, claimed.success));
		if (Result.isFailure(restored)) {
			yield* operations.fail(payload, restored.failure, claimed.success);
			return;
		}
		yield* operations.cleanup(payload, claimed.success);
	},
	(effect, payload) => Effect.annotateLogs(effect, { runId: payload.runId }),
);

export const RestoreBackupJobLive = registerJobHandler(RestoreBackupJob, runRestoreBackupJob);
