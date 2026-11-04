import { InternalError, internalError } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import {
	Context,
	DateTime,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Result,
	Schema,
	Stream,
} from "effect";

import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { ARCHIVE_LIMITS, createArchiveStream } from "../archive/archive";
import { archiveFailure, BackupArchiveError } from "../archive/error";
import { BackupsRepository } from "../runs/repository";
import { BackupStaging } from "../staging";
import { BackupExportSnapshot } from "./snapshot";

const BACKUP_APP_VERSION = "backend-v1";
const EXPORT_EXPIRY_MILLIS = 24 * 60 * 60 * 1_000;
const dateFromMillis = (milliseconds: number) => new Date(milliseconds);
const MAX_ARCHIVE_BYTES = ARCHIVE_LIMITS.maxTotalUncompressedBytes + 64 * 1024 * 1024;
const ExportBackupError = Schema.Union([InternalError, BackupArchiveError]);
type ExportBackupError = typeof ExportBackupError.Type;

const ExportBackupPayload = Schema.Struct({ userId: UserId, runId: BackupRunId });
type ExportBackupPayload = typeof ExportBackupPayload.Type;

const ExportArtifact = Schema.Struct({
	key: Schema.String,
	expiresAt: Schema.String,
	provider: Schema.Literals(["local", "s3"]),
});
type ExportArtifact = typeof ExportArtifact.Type;

export const ExportBackupJob = makeJobKind("backup-export", {
	maxAttempts: 3,
	lease: Duration.minutes(5),
	payload: ExportBackupPayload,
});

const asExportError = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError("backup export operation failed", error)),
		Effect.mapError((error) =>
			error instanceof BackupArchiveError ? error : internalError(message),
		),
		Effect.catchDefect((defect) =>
			Effect.logError("backup export operation defect", defect).pipe(
				Effect.andThen(
					Effect.fail(defect instanceof BackupArchiveError ? defect : internalError(message)),
				),
			),
		),
	);

type ExportBackupOperationsValue = {
	begin: (payload: ExportBackupPayload) => Effect.Effect<boolean, ExportBackupError>;
	build: (payload: ExportBackupPayload) => Effect.Effect<ExportArtifact, ExportBackupError>;
	complete: (
		payload: ExportBackupPayload,
		artifact: ExportArtifact,
	) => Effect.Effect<void, ExportBackupError>;
	fail: (
		payload: ExportBackupPayload,
		error: ExportBackupError,
		artifact?: ExportArtifact,
	) => Effect.Effect<void, ExportBackupError>;
};

export class ExportBackupOperations extends Context.Service<
	ExportBackupOperations,
	ExportBackupOperationsValue
>()("@ryot-app/kernel-backend/modules/backups/export/job/ExportBackupOperations") {}

export const ExportBackupOperationsLive = Layer.effect(
	ExportBackupOperations,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const database = yield* DatabaseSession;
		const fs = yield* FileSystem.FileSystem;
		const uploads = yield* ObjectStorageService;
		const repository = yield* BackupsRepository;
		const staging = yield* BackupStaging;
		const snapshotService = yield* BackupExportSnapshot;
		const localTempDir = config.fileStorage.localTempDir;

		const begin = (payload: ExportBackupPayload) =>
			asExportError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					if (run?.kind !== "export" || run.status === "failed") {
						return yield* internalError("Backup export run is unavailable");
					}
					if (run.status === "completed") {
						return false;
					}
					if (!(yield* repository.markRunRunning({ ...payload, progress: 5 }))) {
						return yield* internalError("Backup export run could not start");
					}
					return true;
				}),
				"Backup export could not start",
			);

		const build = (payload: ExportBackupPayload) =>
			asExportError(
				Effect.gen(function* () {
					const existing = yield* repository.getArtifactById(payload);
					if (existing) {
						return {
							key: existing.artifactKey,
							provider: existing.artifactProvider,
							expiresAt:
								existing.expiresAt ?? (yield* internalError("Backup artifact expiry is missing")),
						};
					}
					yield* staging.recoverAbandoned();
					yield* staging.begin(payload.runId);
					yield* Effect.addFinalizer(() =>
						staging
							.cleanup(payload.runId)
							.pipe(
								Effect.catchCause((cause) =>
									Effect.logWarning("backup export staging cleanup failed", cause),
								),
							),
					);
					yield* fs.makeDirectory(localTempDir, { recursive: true });
					const directory = yield* fs.makeTempDirectoryScoped({
						directory: localTempDir,
						prefix: "ryot-backup-export-",
					});
					const eventsPath = `${directory}/events.ndjson`;
					const snapshot = yield* database.transaction(
						Effect.gen(function* () {
							yield* database.run((db) =>
								db.execute(sql`set transaction isolation level repeatable read`),
							);
							return yield* snapshotService.prepareExportSnapshot(
								payload.userId,
								eventsPath,
								payload.runId,
							);
						}),
					);
					yield* repository.updateProgress({ ...payload, progress: 45 });

					const assetsBySha = new Map<string, (typeof snapshot.managedAssets)[number]>();
					for (const asset of snapshot.managedAssets) {
						const existingAsset = assetsBySha.get(asset.sha256);
						if (
							existingAsset &&
							(existingAsset.size !== asset.size || existingAsset.contentType !== asset.contentType)
						) {
							return yield* internalError("Backup asset metadata is inconsistent");
						}
						assetsBySha.set(asset.sha256, asset);
					}
					const assets = [];
					for (const asset of [...assetsBySha.values()].sort((a, b) =>
						a.sha256.localeCompare(b.sha256),
					)) {
						const stream = Stream.unwrap(
							uploads.openObject({ key: asset.key, type: asset.provider }),
						);
						assets.push({
							chunks: Stream.toAsyncIterable(stream),
							metadata: {
								size: asset.size,
								sha256: asset.sha256,
								contentType: asset.contentType,
								path: `assets/${asset.sha256}`,
							},
						});
					}
					const run = yield* repository.getRunById(payload);
					if (!run) {
						return yield* internalError("Backup export run is unavailable");
					}
					const key = `temporary/${payload.runId}.zip`;
					const locator = { key, type: "local" } as const;
					const archive = createArchiveStream({
						assets,
						archiveId: payload.runId,
						createdAt: run.createdAt,
						records: snapshot.records,
						appVersion: BACKUP_APP_VERSION,
						redactions: snapshot.redactions,
						requiredPlugins: snapshot.requiredPlugins,
						sections: snapshot.sections.map((section) => ({
							path: section.path,
							count: section.count,
							bytes: section.bytes,
							sha256: section.sha256,
							chunks: Stream.toAsyncIterable(fs.stream(section.filePath)),
						})),
					});
					const expiresAt = dateFromMillis(
						(yield* DateTime.nowAsDate).getTime() + EXPORT_EXPIRY_MILLIS,
					);
					let archiveError: undefined | BackupArchiveError;
					yield* uploads
						.writeObject(
							locator,
							archive.pipe(
								Stream.tapError((error) =>
									Effect.sync(() => {
										archiveError = error;
									}),
								),
							),
							"application/zip",
							undefined,
							MAX_ARCHIVE_BYTES,
						)
						.pipe(
							Effect.mapError((error) => archiveError ?? error),
							Effect.catchCause((cause) =>
								uploads
									.deleteObject(locator)
									.pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
							),
						);
					return { key, provider: locator.type, expiresAt: expiresAt.toISOString() };
				}).pipe(Effect.scoped),
				"Backup export failed",
			);

		const complete = (payload: ExportBackupPayload, artifact: ExportArtifact) =>
			asExportError(
				Effect.gen(function* () {
					const completed = yield* repository.completeRun({
						runId: payload.runId,
						userId: payload.userId,
						artifactKey: artifact.key,
						artifactProvider: artifact.provider,
						expiresAt: dateFromMillis(Date.parse(artifact.expiresAt)),
					});
					if (!completed && !(yield* repository.getArtifactById(payload))) {
						return yield* internalError("Backup export could not be completed");
					}
					return yield* Effect.void;
				}),
				"Backup export could not be completed",
			);

		const fail = (
			payload: ExportBackupPayload,
			error: ExportBackupError,
			artifact?: ExportArtifact,
		) =>
			asExportError(
				Effect.gen(function* () {
					const run = yield* repository.getRunById(payload);
					const committedArtifact = yield* repository.getArtifactById(payload);
					const committed = run?.status === "completed" || committedArtifact !== null;
					if (artifact && !committed) {
						yield* uploads
							.deleteObject({ key: artifact.key, type: artifact.provider })
							.pipe(Effect.ignore);
					}
					if (!committed) {
						yield* repository.failRun({
							...payload,
							failure:
								error instanceof BackupArchiveError
									? archiveFailure(error)
									: { operation: "export", code: "unexpected-failure" },
						});
					}
				}),
				"Backup export failure could not be recorded",
			);

		return { fail, begin, build, complete } satisfies ExportBackupOperationsValue;
	}),
);

// A failed step settles the run itself; only a lost process makes the job retry, and the steps are
// idempotent so the retry resumes the run.
export const runExportBackupJob = Effect.fn("ExportBackupJob")(
	function* (payload: ExportBackupPayload, job: JobContext) {
		yield* Effect.annotateCurrentSpan({
			jobId: job.id,
			runId: payload.runId,
			userId: payload.userId,
		});
		const operations = yield* ExportBackupOperations;
		const started = yield* Effect.result(operations.begin(payload));
		if (Result.isFailure(started)) {
			yield* operations.fail(payload, started.failure);
			return;
		}
		if (!started.success) {
			return;
		}
		const built = yield* Effect.result(operations.build(payload));
		if (Result.isFailure(built)) {
			yield* operations.fail(payload, built.failure);
			return;
		}
		const completed = yield* Effect.result(operations.complete(payload, built.success));
		if (Result.isFailure(completed)) {
			yield* operations.fail(payload, completed.failure, built.success);
		}
	},
	(effect, payload) => Effect.annotateLogs(effect, { runId: payload.runId }),
);

export const ExportBackupJobLive = registerJobHandler(ExportBackupJob, runExportBackupJob);
