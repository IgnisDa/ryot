import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { DbError, badRequest, conflict, internalError, notFound } from "@ryot/contract/errors";
import type { CreateRestoreBody } from "@ryot/contract/modules/backups/schemas";
import type { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { Context, DateTime, Effect, Layer, Result } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { BackupDataService } from "#modules/backup-data/data-service";
import { UploadsService } from "#modules/uploads/service";

import { ExportBackupWorkflow } from "./export-workflow";
import { BackupsRepository } from "./repository";
import { RestoreBackupWorkflow } from "./restore-workflow";

const mapDbToInternal = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchIf(
			(error): error is Extract<E, DbError> => error instanceof DbError,
			() => Effect.fail(internalError("Backup persistence failed")),
		),
	);

export class BackupsService extends Context.Service<BackupsService>()("BackupsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const data = yield* BackupDataService;
		const uploads = yield* UploadsService;
		const repository = yield* BackupsRepository;

		const assertAccountIsClean = (userId: UserId) => data.assertAccountIsClean(userId);

		const createExport = Effect.fn("BackupsService.createExport")(function* (
			user: CurrentUserValue,
		) {
			const run = yield* mapDbToInternal(repository.createRun({ userId: user.id, kind: "export" }));
			const dispatched = yield* engine
				.execute(ExportBackupWorkflow, {
					discard: true,
					executionId: run.id,
					payload: { runId: run.id, userId: user.id },
				})
				.pipe(Effect.result);
			if (Result.isFailure(dispatched)) {
				yield* mapDbToInternal(
					repository.failRun({
						runId: run.id,
						userId: user.id,
						error: "Backup export could not be queued",
					}),
				);
				return yield* internalError("Backup export could not be queued");
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
				yield* mapDbToInternal(
					repository.failRun({
						runId: run.id,
						userId: user.id,
						error: "Backup restore could not be queued",
					}),
				);
				return yield* internalError("Backup restore could not be queued");
			}
			return { id: run.id };
		});

		const listRuns = Effect.fn("BackupsService.listRuns")(function* (user: CurrentUserValue) {
			return {
				items: yield* mapDbToInternal(repository.listRunsByUserId({ userId: user.id })),
			};
		});

		const getRun = Effect.fn("BackupsService.getRun")(function* (
			user: CurrentUserValue,
			runId: BackupRunId,
		) {
			const run = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
			return run ?? (yield* notFound("Backup run was not found"));
		});

		const downloadRun = Effect.fn("BackupsService.downloadRun")(function* (
			user: CurrentUserValue,
			runId: BackupRunId,
		) {
			const run = yield* getRun(user, runId);
			if (run.kind !== "export") {
				return yield* badRequest("Restore runs have no download artifact");
			}
			if (run.status === "pending" || run.status === "running") {
				return yield* conflict("Backup export is still running");
			}
			if (run.status !== "completed" || !run.expiresAt) {
				return yield* badRequest("Backup export has no downloadable artifact");
			}
			if (Date.parse(run.expiresAt) <= (yield* DateTime.nowAsDate).getTime()) {
				return yield* notFound("Backup export artifact has expired");
			}
			const artifact = yield* mapDbToInternal(
				repository.getArtifactById({ runId, userId: user.id }),
			);
			if (!artifact) {
				return yield* notFound("Backup export artifact was not found");
			}
			const locator = { type: artifact.artifactProvider, key: artifact.artifactKey } as const;
			const info = yield* uploads
				.statObject(locator)
				.pipe(Effect.mapError(() => internalError("Backup export artifact is unavailable")));
			const stream = yield* uploads
				.openObject(locator)
				.pipe(Effect.mapError(() => internalError("Backup export artifact is unavailable")));
			return { stream, size: info.size, fileName: `ryot-backup-${run.id}.zip` };
		});

		const deleteRun = Effect.fn("BackupsService.deleteRun")(function* (
			user: CurrentUserValue,
			runId: BackupRunId,
		) {
			const run = yield* getRun(user, runId);
			if (run.status === "running") {
				return yield* conflict("Running backup runs cannot be deleted");
			}
			const artifact = yield* mapDbToInternal(
				repository.getArtifactById({ runId, userId: user.id }),
			);
			if (artifact) {
				yield* uploads
					.deleteObject({ type: artifact.artifactProvider, key: artifact.artifactKey })
					.pipe(Effect.mapError(() => internalError("Backup artifact could not be deleted")));
			}
			const deleted = yield* mapDbToInternal(repository.deleteRunById({ runId, userId: user.id }));
			if (!deleted) {
				const current = yield* mapDbToInternal(repository.getRunById({ runId, userId: user.id }));
				return yield* current?.status === "running"
					? conflict("Running backup runs cannot be deleted")
					: notFound("Backup run was not found");
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
						Effect.catchCause((cause) =>
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
