import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import {
	BackupBadRequest,
	BackupConflict,
	BackupInternalError,
	BackupNotFound,
	type CreateRestoreBody,
} from "@ryot-app/contract/modules/backups/schemas";
import type { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, DateTime, Effect, Layer, Result } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { ExportBackupWorkflow } from "./export/workflow";
import { BackupAccountCleanliness } from "./restore/account-cleanliness";
import { RestoreBackupWorkflow } from "./restore/workflow";
import { BackupsRepository } from "./runs/repository";

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
	code: "artifact-storage-unavailable" | "artifact-delete-failed",
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

export class BackupsService extends Context.Service<BackupsService>()("BackupsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const uploads = yield* ObjectStorageService;
		const repository = yield* BackupsRepository;
		const cleanliness = yield* BackupAccountCleanliness;

		const assertAccountIsClean = (userId: UserId) => cleanliness.assertAccountIsClean(userId);

		const createExport = Effect.fn("BackupsService.createExport")(function* (
			user: CurrentUserValue,
		) {
			const run = yield* mapDbToInternal(repository.createRun({ kind: "export", userId: user.id }));
			const dispatched = yield* engine
				.execute(ExportBackupWorkflow, {
					discard: true,
					executionId: run.id,
					payload: { runId: run.id, userId: user.id },
				})
				.pipe(Effect.result);
			if (Result.isFailure(dispatched)) {
				yield* Effect.logError("backup export dispatch failed", dispatched.failure);
				yield* mapDbToInternal(
					repository.failRun({
						runId: run.id,
						userId: user.id,
						failure: { operation: "export", code: "unexpected-failure" },
					}),
				);
				return yield* new BackupInternalError({ reason: { code: "export-dispatch-failed" } });
			}
			return { id: run.id };
		});

		const createRestore = Effect.fn("BackupsService.createRestore")(function* (
			user: CurrentUserValue,
			body: CreateRestoreBody,
		) {
			yield* mapDbToInternal(assertAccountIsClean(user.id));
			const run = yield* mapDbToInternal(
				repository.createRun({ userId: user.id, kind: "restore" }),
			);
			const dispatched = yield* engine
				.execute(RestoreBackupWorkflow, {
					discard: true,
					executionId: run.id,
					payload: { runId: run.id, userId: user.id, uploadToken: body.uploadToken },
				})
				.pipe(Effect.result);
			if (Result.isFailure(dispatched)) {
				yield* Effect.logError("backup restore dispatch failed", dispatched.failure);
				yield* mapDbToInternal(
					repository.failRun({
						runId: run.id,
						userId: user.id,
						failure: { operation: "restore", code: "unexpected-failure" },
					}),
				);
				return yield* new BackupInternalError({ reason: { code: "restore-dispatch-failed" } });
			}
			return { id: run.id };
		});

		const listRuns = Effect.fn("BackupsService.listRuns")(function* (user: CurrentUserValue) {
			return { items: yield* mapDbToInternal(repository.listRunsByUserId({ userId: user.id })) };
		});

		const getRun = Effect.fn("BackupsService.getRun")(function* (
			user: CurrentUserValue,
			runId: BackupRunId,
		) {
			const run = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
			return run ?? (yield* new BackupNotFound({ reason: { code: "run-not-found" } }));
		});

		const downloadRun = Effect.fn("BackupsService.downloadRun")(function* (
			user: CurrentUserValue,
			runId: BackupRunId,
		) {
			const run = yield* getRun(user, runId);
			if (run.kind !== "export") {
				return yield* new BackupBadRequest({ reason: { code: "restore-has-no-artifact" } });
			}
			if (run.status === "pending" || run.status === "running") {
				return yield* new BackupConflict({ reason: { code: "export-still-running" } });
			}
			if (run.status !== "completed" || !run.expiresAt) {
				return yield* new BackupBadRequest({ reason: { code: "export-has-no-artifact" } });
			}
			if (Date.parse(run.expiresAt) <= (yield* DateTime.nowAsDate).getTime()) {
				return yield* new BackupNotFound({ reason: { code: "artifact-expired" } });
			}
			const artifact = yield* mapDbToInternal(
				repository.getArtifactById({ runId, userId: user.id }),
			);
			if (!artifact) {
				return yield* new BackupNotFound({ reason: { code: "artifact-not-found" } });
			}
			const locator = { key: artifact.artifactKey, type: artifact.artifactProvider } as const;
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
			const deleted = yield* mapDbToInternal(repository.deleteRunById({ runId, userId: user.id }));
			if (!deleted) {
				const current = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
				return yield* current?.status === "pending" || current?.status === "running"
					? new BackupConflict({ reason: { code: "run-still-active" } })
					: new BackupNotFound({ reason: { code: "run-not-found" } });
			}
			return { id: deleted.id };
		});

		const cleanupExpiredArtifacts = Effect.fn("BackupsService.cleanupExpiredArtifacts")(function* (
			limit: number,
		) {
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
		});

		return {
			getRun,
			listRuns,
			deleteRun,
			downloadRun,
			createExport,
			createRestore,
			assertAccountIsClean,
			cleanupExpiredArtifacts,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
