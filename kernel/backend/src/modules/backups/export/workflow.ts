import { InternalError, internalError } from "@ryot-app/contract/errors";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, DateTime, Effect, FileSystem, Layer, Result, Schema, Stream } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";

import { ARCHIVE_LIMITS, createArchiveStream } from "../archive/archive";
import { BackupsRepository } from "../runs/repository";
import { BackupExportSnapshot } from "./snapshot";

const BACKUP_APP_VERSION = "backend-v1";
const EXPORT_EXPIRY_MILLIS = 24 * 60 * 60 * 1_000;
const dateFromMillis = (milliseconds: number) => new Date(milliseconds);
const MAX_ARCHIVE_BYTES = ARCHIVE_LIMITS.maxTotalUncompressedBytes + 64 * 1024 * 1024;

const ExportBackupWorkflowPayload = Schema.Struct({ userId: UserId, runId: BackupRunId });
type ExportBackupWorkflowPayload = typeof ExportBackupWorkflowPayload.Type;

const ExportArtifact = Schema.Struct({
	key: Schema.String,
	expiresAt: Schema.String,
	provider: Schema.Literals(["local", "s3"]),
});
type ExportArtifact = typeof ExportArtifact.Type;

export const ExportBackupWorkflow = Workflow.make("ExportBackupWorkflow", {
	idempotencyKey: ({ runId }) => runId,
	success: Schema.Void satisfies DurableSchema,
	error: InternalError satisfies DurableSchema,
	payload: ExportBackupWorkflowPayload satisfies DurableSchema,
});

const asInternal = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError("backup export operation failed", error)),
		Effect.mapError(() => internalError(message)),
		Effect.catchDefect((defect) =>
			Effect.logError("backup export operation defect", defect).pipe(
				Effect.andThen(Effect.fail(internalError(message))),
			),
		),
	);

type ExportBackupWorkflowOperationsValue = {
	begin: (payload: ExportBackupWorkflowPayload) => Effect.Effect<boolean, InternalError>;
	build: (payload: ExportBackupWorkflowPayload) => Effect.Effect<ExportArtifact, InternalError>;
	complete: (
		payload: ExportBackupWorkflowPayload,
		artifact: ExportArtifact,
	) => Effect.Effect<void, InternalError>;
	fail: (
		payload: ExportBackupWorkflowPayload,
		error: InternalError,
		artifact?: ExportArtifact,
	) => Effect.Effect<void, InternalError>;
};

export class ExportBackupWorkflowOperations extends Context.Service<
	ExportBackupWorkflowOperations,
	ExportBackupWorkflowOperationsValue
>()("ExportBackupWorkflowOperations") {}

export const ExportBackupWorkflowOperationsLive = Layer.effect(
	ExportBackupWorkflowOperations,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const database = yield* Database;
		const fs = yield* FileSystem.FileSystem;
		const uploads = yield* ObjectStorageService;
		const repository = yield* BackupsRepository;
		const snapshotService = yield* BackupExportSnapshot;
		const localTempDir = config.fileStorage.localTempDir;

		const begin = (payload: ExportBackupWorkflowPayload) =>
			asInternal(
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

		const build = (payload: ExportBackupWorkflowPayload) =>
			asInternal(
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
					yield* fs.makeDirectory(localTempDir, { recursive: true });
					const directory = yield* fs.makeTempDirectoryScoped({
						directory: localTempDir,
						prefix: "ryot-backup-export-",
					});
					const eventsPath = `${directory}/events.ndjson`;
					const snapshot = yield* mapDatabaseErrors(
						database.transaction(
							(transaction) =>
								snapshotService
									.prepareExportSnapshot(payload.userId, eventsPath)
									.pipe(Effect.provideService(Database, transaction)),
							{ accessMode: "read only", isolationLevel: "repeatable read" },
						),
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
						const stream = yield* uploads.openObject({ key: asset.key, type: asset.provider });
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
					const provider = yield* uploads.selectStorageProvider("temporary");
					const key = `temporary/${payload.runId}.zip`;
					const locator = { key, type: provider } as const;
					const archive = createArchiveStream({
						assets,
						archiveId: payload.runId,
						createdAt: run.createdAt,
						records: snapshot.records,
						appVersion: BACKUP_APP_VERSION,
						redactions: snapshot.redactions,
						requiredPlugins: snapshot.requiredPlugins,
						events: {
							count: snapshot.events.count,
							bytes: snapshot.events.bytes,
							sha256: snapshot.events.sha256,
							chunks: Stream.toAsyncIterable(fs.stream(snapshot.events.path)),
						},
					});
					const expiresAt = dateFromMillis(
						(yield* DateTime.nowAsDate).getTime() + EXPORT_EXPIRY_MILLIS,
					);
					yield* uploads
						.writeObject(locator, archive, "application/zip", undefined, MAX_ARCHIVE_BYTES)
						.pipe(
							Effect.catchCause((cause) =>
								uploads
									.deleteObject(locator)
									.pipe(Effect.ignore, Effect.andThen(Effect.failCause(cause))),
							),
						);
					return { key, provider, expiresAt: expiresAt.toISOString() };
				}).pipe(Effect.scoped),
				"Backup export failed",
			);

		const complete = (payload: ExportBackupWorkflowPayload, artifact: ExportArtifact) =>
			asInternal(
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
			payload: ExportBackupWorkflowPayload,
			_error: InternalError,
			artifact?: ExportArtifact,
		) =>
			asInternal(
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
							failure: { operation: "export", code: "unexpected-failure" },
						});
					}
				}),
				"Backup export failure could not be recorded",
			);

		const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database>) =>
			effect.pipe(Effect.provideService(Database, database));
		return {
			begin: (payload) => provideDatabase(begin(payload)),
			build: (payload) => provideDatabase(build(payload)),
			complete: (payload, artifact) => provideDatabase(complete(payload, artifact)),
			fail: (payload, error, artifact) => provideDatabase(fail(payload, error, artifact)),
		} satisfies ExportBackupWorkflowOperationsValue;
	}),
);

export const runExportBackupWorkflow = Effect.fn("ExportBackupWorkflow")(
	function* (payload: ExportBackupWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
		});
		const operations = yield* ExportBackupWorkflowOperations;
		const started = yield* makeActivity({
			name: "begin-backup-export",
			execute: operations.begin(payload),
			error: InternalError satisfies DurableSchema,
			success: Schema.Boolean satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(started)) {
			yield* makeActivity({
				name: "fail-unstarted-backup-export",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, started.failure),
			});
			return;
		}
		if (!started.success) {
			return;
		}
		const built = yield* makeActivity({
			name: "build-backup-export",
			execute: operations.build(payload),
			error: InternalError satisfies DurableSchema,
			success: ExportArtifact satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(built)) {
			yield* makeActivity({
				name: "fail-backup-export",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, built.failure),
			});
			return;
		}
		const completed = yield* makeActivity({
			name: "complete-backup-export",
			success: Schema.Void satisfies DurableSchema,
			error: InternalError satisfies DurableSchema,
			execute: operations.complete(payload, built.success),
		}).pipe(Effect.result);
		if (Result.isFailure(completed)) {
			yield* makeActivity({
				name: "fail-completed-backup-export",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, completed.failure, built.success),
			});
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ExportBackupWorkflow" }),
);

export const ExportBackupWorkflowDefinitionsLive = implementWorkflow(
	ExportBackupWorkflow,
	runExportBackupWorkflow,
);
