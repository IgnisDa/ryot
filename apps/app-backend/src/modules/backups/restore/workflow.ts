import { BadRequest, Conflict, DbError, InternalError, internalError } from "@ryot/contract/errors";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, FileSystem, Layer, Result, Schedule, Schema } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { type StagedPermanentAsset, UploadsService } from "#modules/uploads/service";

import { validateV1ArchiveStream } from "../archive-v1/archive";
import { BackupArchiveError } from "../archive-v1/error";
import { BackupsRepository } from "../runs/repository";
import { BackupAccountCleanliness } from "./account-cleanliness";
import { BackupRestoreWriter } from "./writer";

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

export const RestoreBackupWorkflow = Workflow.make("RestoreBackupWorkflow", {
	idempotencyKey: ({ runId }) => runId,
	success: Schema.Void satisfies DurableSchema,
	error: InternalError satisfies DurableSchema,
	payload: RestoreBackupWorkflowPayload satisfies DurableSchema,
});

const asInternal = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	message: string,
	preserveSafeMessage = false,
) =>
	effect.pipe(
		Effect.mapError((error) =>
			preserveSafeMessage &&
			(error instanceof BackupArchiveError ||
				error instanceof BadRequest ||
				error instanceof Conflict)
				? internalError(error.message.slice(0, 500))
				: internalError(message),
		),
		Effect.catchDefect(() => Effect.fail(internalError(message))),
	);

type RestoreBackupWorkflowOperationsValue = {
	begin: (payload: RestoreBackupWorkflowPayload) => Effect.Effect<boolean, InternalError>;
	claim: (payload: RestoreBackupWorkflowPayload) => Effect.Effect<ClaimedArchive, InternalError>;
	restore: (
		payload: RestoreBackupWorkflowPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, InternalError>;
	cleanup: (
		payload: RestoreBackupWorkflowPayload,
		archive: ClaimedArchive,
	) => Effect.Effect<void, InternalError>;
	fail: (
		payload: RestoreBackupWorkflowPayload,
		error: InternalError,
		archive?: ClaimedArchive,
	) => Effect.Effect<void, InternalError>;
};

export class RestoreBackupWorkflowOperations extends Context.Service<
	RestoreBackupWorkflowOperations,
	RestoreBackupWorkflowOperationsValue
>()("RestoreBackupWorkflowOperations") {}

export const RestoreBackupWorkflowOperationsLive = Layer.effect(
	RestoreBackupWorkflowOperations,
	Effect.gen(function* () {
		const database = yield* Database;
		const writer = yield* BackupRestoreWriter;
		const cleanliness = yield* BackupAccountCleanliness;
		const uploads = yield* UploadsService;
		const fs = yield* FileSystem.FileSystem;
		const repository = yield* BackupsRepository;

		const begin = (payload: RestoreBackupWorkflowPayload) =>
			asInternal(
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
				"Backup restore could not start",
				true,
			);

		const claim = (payload: RestoreBackupWorkflowPayload) =>
			asInternal(
				uploads.claimTemporaryUpload(payload.uploadToken, payload.userId, payload.runId).pipe(
					Effect.map(({ intentId, locator }) => ({
						intentId,
						key: locator.key,
						provider: locator.type,
					})),
				),
				"Backup upload could not be claimed",
			);

		const restore = (payload: RestoreBackupWorkflowPayload, archive: ClaimedArchive) =>
			asInternal(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (!run) {
						return yield* internalError("Backup restore run is unavailable");
					}
					if (run.progress >= 90) {
						return yield* Effect.void;
					}
					const source = yield* uploads.openObject({ type: archive.provider, key: archive.key });
					const validated = yield* validateV1ArchiveStream(source).pipe(
						Effect.provideService(FileSystem.FileSystem, fs),
					);
					const stagedBySha = new Map<string, StagedPermanentAsset>();
					yield* Effect.gen(function* () {
						yield* writer.assertRequiredPlugins(
							validated.manifest.requiredPlugins,
							validated.records,
						);
						const provider = yield* uploads.selectStorageProvider("permanent");
						for (const asset of validated.assets) {
							if (stagedBySha.has(asset.sha256)) {
								continue;
							}
							const staged = yield* uploads.stageContentAddressedPermanentAsset({
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
										yield* cleanliness.assertAccountIsClean(payload.userId);
										for (const staged of stagedBySha.values()) {
											yield* uploads.registerManagedAsset(staged.metadata);
										}
										yield* writer.restoreRecords(payload.userId, validated.records, assetLocators);
										if (!(yield* repository.updateProgress({ ...payload, progress: 90 }))) {
											return yield* internalError(
												"Backup restore checkpoint could not be recorded",
											);
										}
										return yield* Effect.void;
									}).pipe(Effect.provideService(Database, transaction)),
								{ isolationLevel: "serializable", accessMode: "read write" },
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
								(staged) => uploads.cleanupStagedPermanentAsset(staged).pipe(Effect.ignore),
								{ discard: true },
							).pipe(Effect.andThen(Effect.failCause(cause))),
						),
						Effect.ensuring(validated.cleanup.pipe(Effect.orDie)),
					);
					return yield* Effect.void;
				}),
				"Backup restore failed",
				true,
			);

		const cleanup = (payload: RestoreBackupWorkflowPayload, archive: ClaimedArchive) =>
			asInternal(
				Effect.gen(function* () {
					const completed = yield* repository.completeRun(payload);
					if (!completed) {
						const run = yield* repository.getRunById(payload);
						if (run?.status !== "completed") {
							return yield* internalError("Backup restore could not be completed");
						}
					}
					yield* uploads.deleteTemporaryUpload(archive.intentId).pipe(
						Effect.retry(Schedule.recurs(2)),
						Effect.catchCause((cause) =>
							Effect.logWarning("backup restore temporary upload cleanup failed", cause).pipe(
								Effect.annotateLogs({ runId: payload.runId }),
							),
						),
					);
					return yield* Effect.void;
				}),
				"Backup restore could not be completed",
			);

		const fail = (
			payload: RestoreBackupWorkflowPayload,
			error: InternalError,
			archive?: ClaimedArchive,
		) =>
			asInternal(
				Effect.gen(function* () {
					yield* repository.failRun({ ...payload, error: error.message });
					if (archive) {
						yield* uploads
							.deleteTemporaryUpload(archive.intentId)
							.pipe(Effect.retry(Schedule.recurs(2)), Effect.ignore);
					}
				}),
				"Backup restore failure could not be recorded",
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
			error: InternalError satisfies DurableSchema,
			success: Schema.Boolean satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(started)) {
			yield* Activity.make({
				name: "fail-unstarted-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
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
			error: InternalError satisfies DurableSchema,
			success: ClaimedArchive satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(claimed)) {
			yield* Activity.make({
				name: "fail-unclaimed-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, claimed.failure),
			});
			return;
		}
		const restored = yield* Activity.make({
			name: "write-backup-restore",
			success: Schema.Void satisfies DurableSchema,
			error: InternalError satisfies DurableSchema,
			execute: operations.restore(payload, claimed.success),
		}).pipe(Effect.result);
		if (Result.isFailure(restored)) {
			yield* Activity.make({
				name: "fail-backup-restore",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, restored.failure, claimed.success),
			});
			return;
		}
		yield* Activity.make({
			name: "cleanup-backup-restore",
			success: Schema.Void satisfies DurableSchema,
			error: InternalError satisfies DurableSchema,
			execute: operations.cleanup(payload, claimed.success),
		});
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "RestoreBackupWorkflow" }),
);

export const RestoreBackupWorkflowDefinitionsLive =
	RestoreBackupWorkflow.toLayer(runRestoreBackupWorkflow);
