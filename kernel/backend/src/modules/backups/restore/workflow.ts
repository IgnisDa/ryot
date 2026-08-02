import { BadRequest, DbError, internalError } from "@ryot-app/contract/errors";
import {
	BackupConflict,
	BackupRunFailure,
	type BackupRunFailure as BackupRunFailureValue,
} from "@ryot-app/contract/modules/backups/schemas";
import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, FileSystem, Layer, Result, Schedule, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { acquireUserWriteLock } from "#lib/infrastructure/db/user-write-lock";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { PluginBackupRestore } from "#modules/plugins/backup-restore";
import { UploadIntentsService } from "#modules/uploads/intents/service";
import {
	ManagedAssetsService,
	type StagedPermanentAsset,
} from "#modules/uploads/managed-assets/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { validateArchiveStream } from "../archive/archive";
import { BackupArchiveError, type BackupArchiveErrorReason } from "../archive/error";
import { BackupsRepository } from "../runs/repository";
import { BackupAccountCleanliness } from "./account-cleanliness";
import {
	BackupRestoreWriter,
	preflightProvenance,
	RequiredBackupPluginUnavailable,
} from "./writer";

const RestoreBackupWorkflowPayload = Schema.Struct({
	userId: UserId,
	runId: BackupRunId,
	uploadToken: Schema.String,
});
type RestoreBackupWorkflowPayload = typeof RestoreBackupWorkflowPayload.Type;

const ClaimedArchive = Schema.Struct({
	key: Schema.String,
	intentId: Schema.String,
	provider: Schema.Literals(["local", "s3"]),
});
type ClaimedArchive = typeof ClaimedArchive.Type;

export class BackupWorkflowError extends Schema.TaggedError<BackupWorkflowError>()(
	"BackupWorkflowError",
	{ failure: BackupRunFailure },
) {}

export const RestoreBackupWorkflow = Workflow.make("RestoreBackupWorkflow", {
	idempotencyKey: ({ runId }) => runId,
	success: Schema.Void satisfies DurableSchema,
	error: BackupWorkflowError satisfies DurableSchema,
	payload: RestoreBackupWorkflowPayload satisfies DurableSchema,
});

type InvalidArchiveIssue = Extract<BackupRunFailureValue, { code: "archive-invalid" }>["issue"];

const invalidArchiveIssues = {
	invalid_path: "invalid-path",
	invalid_entry: "invalid-entry",
	missing_entry: "missing-entry",
	count_mismatch: "count-mismatch",
	duplicate_path: "duplicate-path",
	entry_too_large: "entry-too-large",
	invalid_archive: "invalid-archive",
	unexpected_path: "unexpected-path",
	truncated_ndjson: "truncated-ndjson",
	undeclared_asset: "undeclared-asset",
	checksum_mismatch: "checksum-mismatch",
	duplicate_record_id: "duplicate-record-id",
	total_size_exceeded: "total-size-exceeded",
	entry_count_exceeded: "entry-count-exceeded",
	missing_reference_mapping: "missing-reference-mapping",
} as const satisfies Record<
	Exclude<BackupArchiveErrorReason, "unsupported_compression" | "unsupported_format">,
	InvalidArchiveIssue
>;

const archiveFailure = (error: BackupArchiveError): BackupRunFailureValue => {
	if (error.reason === "unsupported_compression") {
		return { code: "archive-unsupported", feature: "compression" };
	}
	if (error.reason === "unsupported_format") {
		return { code: "archive-unsupported", feature: "format" };
	}
	return { code: "archive-invalid", issue: invalidArchiveIssues[error.reason] };
};

const restoreFailure = (error: unknown): BackupRunFailureValue => {
	if (error instanceof BackupArchiveError) {
		return archiveFailure(error);
	}
	if (error instanceof RequiredBackupPluginUnavailable) {
		return {
			pluginSlug: error.pluginSlug,
			code: "required-plugin-unavailable",
			requiredVersion: error.requiredVersion,
		};
	}
	if (error instanceof BackupConflict && error.reason.code === "account-not-clean") {
		return error.reason;
	}
	if (error instanceof BadRequest) {
		return { code: "archive-invalid", issue: "invalid-entry" };
	}
	return { code: "unexpected-failure", operation: "restore" };
};

const asWorkflowError = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	failure: BackupRunFailureValue,
	classify: (error: E) => BackupRunFailureValue = () => failure,
) =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError("backup restore operation failed", error)),
		Effect.mapError((error) => new BackupWorkflowError({ failure: classify(error) })),
		Effect.catchDefect((defect) =>
			Effect.logError("backup restore operation defect", defect).pipe(
				Effect.andThen(Effect.fail(new BackupWorkflowError({ failure }))),
			),
		),
	);

type RestoreBackupWorkflowOperationsValue = {
	begin: (payload: RestoreBackupWorkflowPayload) => Effect.Effect<boolean, BackupWorkflowError>;
	claim: (
		payload: RestoreBackupWorkflowPayload,
	) => Effect.Effect<ClaimedArchive, BackupWorkflowError>;
	restore: (
		payload: RestoreBackupWorkflowPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, BackupWorkflowError>;
	cleanup: (
		payload: RestoreBackupWorkflowPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, BackupWorkflowError>;
	fail: (
		payload: RestoreBackupWorkflowPayload,
		error: BackupWorkflowError,
		archive?: ClaimedArchive,
	) => Effect.Effect<void, BackupWorkflowError>;
};

export class RestoreBackupWorkflowOperations extends Context.Service<
	RestoreBackupWorkflowOperations,
	RestoreBackupWorkflowOperationsValue
>()("RestoreBackupWorkflowOperations") {}

export const RestoreBackupWorkflowOperationsLive = Layer.effect(
	RestoreBackupWorkflowOperations,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const database = yield* Database;
		const fs = yield* FileSystem.FileSystem;
		const writer = yield* BackupRestoreWriter;
		const repository = yield* BackupsRepository;
		const pluginRestore = yield* PluginBackupRestore;
		const uploadIntents = yield* UploadIntentsService;
		const managedAssets = yield* ManagedAssetsService;
		const objectStorage = yield* ObjectStorageService;
		const cleanliness = yield* BackupAccountCleanliness;

		const begin = (payload: RestoreBackupWorkflowPayload) =>
			asWorkflowError(
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
				{ code: "unexpected-failure", operation: "restore" },
				restoreFailure,
			);

		const claim = (payload: RestoreBackupWorkflowPayload) =>
			asWorkflowError(
				uploadIntents
					.claimTemporaryUpload(payload.uploadToken, payload.userId, payload.runId)
					.pipe(
						Effect.map(({ intentId, locator }) => ({
							intentId,
							key: locator.key,
							provider: locator.type,
						})),
					),
				{ code: "upload-unavailable" },
			);

		const restore = (payload: RestoreBackupWorkflowPayload, archive: ClaimedArchive) =>
			asWorkflowError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (!run) {
						return yield* internalError("Backup restore run is unavailable");
					}
					if (run.progress >= 90) {
						return yield* Effect.void;
					}
					const source = yield* objectStorage.openObject({
						key: archive.key,
						type: archive.provider,
					});
					const validated = yield* validateArchiveStream(source, {
						directory: config.fileStorage.localTempDir,
					}).pipe(Effect.provideService(FileSystem.FileSystem, fs));
					const stagedBySha = new Map<string, StagedPermanentAsset>();
					yield* Effect.gen(function* () {
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
						yield* preflightProvenance(
							validated.records,
							validated.events,
							preflightPluginIds,
							preflightDefinitions,
						);
						const provider = yield* objectStorage.selectStorageProvider("permanent");
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
						yield* mapDatabaseErrors(
							database.transaction(
								(transaction) =>
									Effect.gen(function* () {
										yield* acquireUserWriteLock(payload.userId);
										yield* cleanliness.assertAccountIsClean(payload.userId);
										const pluginIdByKey = new Map(systemPluginIds);
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
										for (const staged of stagedBySha.values()) {
											yield* managedAssets.registerManagedAssetInLockedTransaction(staged.metadata);
										}
										yield* writer.restoreRecords(
											payload.userId,
											validated.records,
											assetLocators,
											validated.events,
											pluginIdByKey,
											definitions,
										);
										if (!(yield* repository.updateProgress({ ...payload, progress: 90 }))) {
											return yield* internalError(
												"Backup restore checkpoint could not be recorded",
											);
										}
										return yield* Effect.void;
									}).pipe(Effect.provideService(Database, transaction)),
								{ isolationLevel: "read committed", accessMode: "read write" },
							),
						).pipe(
							Effect.retry({
								times: 2,
								while: (error) => error instanceof DbError && error.code === "40001",
							}),
						);
					}).pipe(
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
				{ code: "unexpected-failure", operation: "restore" },
				restoreFailure,
			);

		const cleanup = (payload: RestoreBackupWorkflowPayload, archive: ClaimedArchive) =>
			asWorkflowError(
				Effect.gen(function* () {
					const completed = yield* repository.completeRun(payload);
					if (!completed) {
						const run = yield* repository.getRunById(payload);
						if (run?.status !== "completed") {
							return yield* internalError("Backup restore could not be completed");
						}
					}
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
				{ code: "unexpected-failure", operation: "restore" },
			);

		const fail = (
			payload: RestoreBackupWorkflowPayload,
			error: BackupWorkflowError,
			archive?: ClaimedArchive,
		) =>
			asWorkflowError(
				Effect.gen(function* () {
					yield* repository.failRun({ ...payload, failure: error.failure });
					if (archive) {
						yield* uploadIntents
							.deleteTemporaryUpload(archive.intentId)
							.pipe(Effect.retry(Schedule.recurs(2)), Effect.ignore);
					}
				}),
				{ code: "unexpected-failure", operation: "restore" },
			);

		const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database>) =>
			effect.pipe(Effect.provideService(Database, database));
		return {
			claim,
			begin: (payload) => provideDatabase(begin(payload)),
			restore: (payload, archive) => provideDatabase(restore(payload, archive)),
			cleanup: (payload, archive) => provideDatabase(cleanup(payload, archive)),
			fail: (payload, error, archive) => provideDatabase(fail(payload, error, archive)),
		} satisfies RestoreBackupWorkflowOperationsValue;
	}),
);

export const runRestoreBackupWorkflow = Effect.fn("RestoreBackupWorkflow")(
	function* (payload: RestoreBackupWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
		});
		const operations = yield* RestoreBackupWorkflowOperations;
		const started = yield* Activity.make({
			name: "begin-backup-restore",
			execute: operations.begin(payload),
			success: Schema.Boolean satisfies DurableSchema,
			error: BackupWorkflowError satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(started)) {
			yield* Activity.make({
				name: "fail-unstarted-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: BackupWorkflowError satisfies DurableSchema,
				execute: operations.fail(payload, started.failure),
			});
			return;
		}
		if (!started.success) {
			return;
		}
		const claimed = yield* Activity.make({
			name: "claim-backup-restore",
			execute: operations.claim(payload),
			success: ClaimedArchive satisfies DurableSchema,
			error: BackupWorkflowError satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(claimed)) {
			yield* Activity.make({
				name: "fail-unclaimed-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: BackupWorkflowError satisfies DurableSchema,
				execute: operations.fail(payload, claimed.failure),
			});
			return;
		}
		const restored = yield* Activity.make({
			name: "write-backup-restore",
			success: Schema.Void satisfies DurableSchema,
			error: BackupWorkflowError satisfies DurableSchema,
			execute: operations.restore(payload, claimed.success),
		}).pipe(Effect.result);
		if (Result.isFailure(restored)) {
			yield* Activity.make({
				name: "fail-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: BackupWorkflowError satisfies DurableSchema,
				execute: operations.fail(payload, restored.failure, claimed.success),
			});
			return;
		}
		yield* Activity.make({
			name: "cleanup-backup-restore",
			success: Schema.Void satisfies DurableSchema,
			error: BackupWorkflowError satisfies DurableSchema,
			execute: operations.cleanup(payload, claimed.success),
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "RestoreBackupWorkflow" }),
);

export const RestoreBackupWorkflowDefinitionsLive =
	RestoreBackupWorkflow.toLayer(runRestoreBackupWorkflow);
