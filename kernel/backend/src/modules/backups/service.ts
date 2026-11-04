import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import {
	BackupBadRequest,
	BackupConflict,
	BackupInternalError,
	BackupNotFound,
	type CreateRestoreBody,
} from "@ryot-app/contract/modules/backups/schemas";
import type { BackupRunId } from "@ryot-app/contract/schema/brands";
import { UserId } from "@ryot-app/contract/schema/brands";
import type { Schema } from "effect";
import { Cause, Context, DateTime, Effect, Layer } from "effect";

import { ObjectStorageService } from "#modules/assets/storage/object-storage";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { DownloadTickets } from "#platform/storage/download-tickets";

import { ExportBackupJob } from "./export/job";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import { RestoreBackupJob } from "./restore/job";
import { BackupsRepository } from "./runs/repository";
import { BackupStaging } from "./staging";

const mapDbToInternal = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			(error) =>
				Effect.logError("backup persistence failed", error).pipe(
					Effect.andThen(
						Effect.fail(new BackupInternalError({ reason: { code: "persistence-failed" } })),
					),
				),
		),
	);

const storageFailure = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	code: "artifact-delete-failed" | "artifact-storage-unavailable",
) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) =>
				Effect.logError("backup artifact storage operation failed", cause).pipe(
					Effect.andThen(Effect.fail(new BackupInternalError({ reason: { code } }))),
				),
		),
		Effect.mapError(() => new BackupInternalError({ reason: { code } })),
	);

export class BackupsService extends Context.Service<BackupsService>()(
	"@ryot-app/kernel-backend/modules/backups/service/BackupsService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const jobs = yield* JobQueue;
			const uploads = yield* ObjectStorageService;
			const repository = yield* BackupsRepository;
			const staging = yield* BackupStaging;
			const cleanliness = yield* BackupAccountCleanliness;
			const downloadTickets = yield* DownloadTickets;

			const assertAccountIsClean = (userId: UserId) => cleanliness.assertAccountIsClean(userId);

			// The run and its job commit together, so every pending run has a job to start it.
			const startRun = (
				userId: UserId,
				kind: "export" | "restore",
				enqueue: (runId: BackupRunId) => Effect.Effect<boolean, DbError | Schema.SchemaError>,
			) =>
				mapDbToInternal(
					database
						.transaction(
							Effect.gen(function* () {
								const run = yield* repository.createRun({ kind, userId });
								yield* enqueue(run.id);
								return run;
							}),
						)
						.pipe(
							Effect.catchTags({ SchemaError: Effect.die, DatabaseSessionStateError: Effect.die }),
						),
				);

			const createExport = Effect.fn("BackupsService.createExport")(function* (
				user: CurrentUserValue,
			) {
				const run = yield* startRun(user.id, "export", (runId) =>
					jobs.enqueue(ExportBackupJob, { runId, userId: user.id }, { userId: user.id }),
				);
				return { id: run.id };
			});

			const createRestore = Effect.fn("BackupsService.createRestore")(function* (
				user: CurrentUserValue,
				body: CreateRestoreBody,
			) {
				yield* mapDbToInternal(assertAccountIsClean(user.id));
				const run = yield* startRun(user.id, "restore", (runId) =>
					jobs.enqueue(
						RestoreBackupJob,
						{ runId, userId: user.id, uploadToken: body.uploadToken },
						{ userId: user.id },
					),
				);
				return { id: run.id };
			});

			const getRun = Effect.fn("BackupsService.getRun")(function* (
				user: CurrentUserValue,
				runId: BackupRunId,
			) {
				const run = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
				return run ?? (yield* new BackupNotFound({ reason: { code: "run-not-found" } }));
			});

			const resolveDownloadArtifact = Effect.fn("BackupsService.resolveDownloadArtifact")(
				function* (userId: UserId, runId: BackupRunId) {
					const run = yield* mapDbToInternal(repository.getRunById({ runId, userId }));
					if (!run) {
						return yield* new BackupNotFound({ reason: { code: "run-not-found" } });
					}
					if (run.kind !== "export") {
						return yield* new BackupBadRequest({ reason: { code: "restore-has-no-artifact" } });
					}
					if (run.status === "pending" || run.status === "running") {
						return yield* new BackupConflict({ reason: { code: "export-still-running" } });
					}
					if (run.status !== "completed" || !run.expiresAt) {
						return yield* new BackupBadRequest({ reason: { code: "export-has-no-artifact" } });
					}
					if (
						DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(run.expiresAt), yield* DateTime.now)
					) {
						return yield* new BackupNotFound({ reason: { code: "artifact-expired" } });
					}
					const artifact = yield* mapDbToInternal(repository.getArtifactById({ runId, userId }));
					if (!artifact) {
						return yield* new BackupNotFound({ reason: { code: "artifact-not-found" } });
					}
					const locator = { key: artifact.artifactKey, type: artifact.artifactProvider } as const;
					return { run, locator };
				},
			);

			const downloadRunForUser = Effect.fn("BackupsService.downloadRunForUser")(function* (
				userId: UserId,
				runId: BackupRunId,
			) {
				const { run, locator } = yield* resolveDownloadArtifact(userId, runId);
				const info = yield* storageFailure(
					uploads.statObject(locator),
					"artifact-storage-unavailable",
				);
				const stream = yield* storageFailure(
					uploads.openObject(locator),
					"artifact-storage-unavailable",
				);
				return { stream, size: info.size, fileName: `ryot-backup-${run.id}.zip` };
			});

			const createDownloadTicket = Effect.fn("BackupsService.createDownloadTicket")(function* (
				user: CurrentUserValue,
				runId: BackupRunId,
			) {
				yield* resolveDownloadArtifact(user.id, runId);
				return yield* downloadTickets.issue({
					resource: runId,
					subject: user.id,
					purpose: "backup-run",
				});
			});

			const downloadRunWithTicket = Effect.fn("BackupsService.downloadRunWithTicket")(function* (
				runId: BackupRunId,
				ticket: string,
			) {
				const claims = yield* downloadTickets
					.verify(ticket, { resource: runId, purpose: "backup-run" })
					.pipe(
						Effect.catchTag("DownloadTicketInvalid", () =>
							Effect.fail(new BackupNotFound({ reason: { code: "artifact-not-found" } })),
						),
					);
				if (claims.subject === null) {
					return yield* new BackupNotFound({ reason: { code: "artifact-not-found" } });
				}
				return yield* downloadRunForUser(UserId.make(claims.subject), runId);
			});

			const deleteRun = Effect.fn("BackupsService.deleteRun")(function* (
				user: CurrentUserValue,
				runId: BackupRunId,
			) {
				const run = yield* getRun(user, runId);
				if (run.status === "pending" || run.status === "running") {
					return yield* new BackupConflict({ reason: { code: "run-still-active" } });
				}
				const artifact = yield* mapDbToInternal(
					repository.getArtifactById({ runId, userId: user.id }),
				);
				if (artifact) {
					yield* storageFailure(
						uploads.deleteObject({ key: artifact.artifactKey, type: artifact.artifactProvider }),
						"artifact-delete-failed",
					);
				}
				const deleted = yield* mapDbToInternal(
					repository.deleteRunById({ runId, userId: user.id }),
				);
				if (!deleted) {
					const current = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
					return yield* current?.status === "pending" || current?.status === "running"
						? new BackupConflict({ reason: { code: "run-still-active" } })
						: new BackupNotFound({ reason: { code: "run-not-found" } });
				}
				return { id: deleted.id };
			});

			const cleanupExpiredArtifacts = Effect.fn("BackupsService.cleanupExpiredArtifacts")(
				function* (limit: number) {
					yield* staging.recoverAbandoned();
					const artifacts = yield* repository.listExpiredArtifacts({ limit });
					yield* Effect.forEach(
						artifacts,
						(artifact) =>
							Effect.gen(function* () {
								yield* uploads.deleteObject({
									key: artifact.artifactKey,
									type: artifact.artifactProvider,
								});
								yield* repository.deleteExpiredRunById({ runId: artifact.id });
							}).pipe(
								Effect.catchCauseIf(
									(cause) => !Cause.hasInterruptsOnly(cause),
									(cause) =>
										Effect.logWarning("backup artifact cleanup failed", cause).pipe(
											Effect.annotateLogs({ runId: artifact.id }),
										),
								),
							),
						{ discard: true },
					);
				},
			);

			return {
				deleteRun,
				createExport,
				createRestore,
				assertAccountIsClean,
				createDownloadTicket,
				downloadRunWithTicket,
				cleanupExpiredArtifacts,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
