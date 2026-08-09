import { InternalError, internalError } from "@ryot/contract/errors";
import { BackupRunId, UserId } from "@ryot/contract/schema/brands";
import { CryptoHasher } from "bun";
import { Context, DateTime, Effect, Layer, Result, Schema, Stream } from "effect";
import { Activity, Workflow } from "effect/unstable/workflow";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { BackupDataService } from "#modules/backup-data/data-service";
import { UploadsService } from "#modules/uploads/service";

import { BackupsRepository } from "./repository";
import { createV1ArchiveStream, V1_ARCHIVE_LIMITS } from "./v1-archive";

const BACKUP_APP_VERSION = "backend-v1";
const EXPORT_EXPIRY_MILLIS = 24 * 60 * 60 * 1_000;
const dateFromMillis = (milliseconds: number) => new Date(milliseconds);
const MAX_ARCHIVE_BYTES = V1_ARCHIVE_LIMITS.maxTotalUncompressedBytes + 64 * 1024 * 1024;

const ExportBackupWorkflowPayload = Schema.Struct({
	userId: UserId,
	runId: BackupRunId,
});
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
	effect.pipe(Effect.catchCause(() => Effect.fail(internalError(message))));

type ExportBackupWorkflowOperationsValue = {
	begin: (payload: ExportBackupWorkflowPayload) => Effect.Effect<boolean, InternalError>;
	build: (payload: ExportBackupWorkflowPayload) => Effect.Effect<ExportArtifact, InternalError>;
	complete: (
		payload: ExportBackupWorkflowPayload,
		artifact: ExportArtifact,
	) => Effect.Effect<void, InternalError>;
	fail: (
		payload: ExportBackupWorkflowPayload,
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
		const database = yield* Database;
		const data = yield* BackupDataService;
		const uploads = yield* UploadsService;
		const repository = yield* BackupsRepository;

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
					const snapshot = yield* mapDatabaseErrors(
						database.transaction(
							(transaction) =>
								data
									.prepareExportSnapshot(payload.userId)
									.pipe(Effect.provideService(Database, transaction)),
							{ isolationLevel: "repeatable read", accessMode: "read only" },
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
					for (const asset of assetsBySha.values()) {
						let size = 0;
						const hasher = new CryptoHasher("sha256");
						const stream = yield* uploads.openObject({ type: asset.provider, key: asset.key });
						yield* Stream.runForEach(stream, (chunk) =>
							Effect.sync(() => {
								size += chunk.byteLength;
								hasher.update(chunk);
							}),
						);
						if (size !== asset.size || hasher.digest("hex") !== asset.sha256) {
							return yield* internalError("Backup asset does not match its registered metadata");
						}
					}

					const assets = [];
					for (const asset of [...assetsBySha.values()].sort((a, b) =>
						a.sha256.localeCompare(b.sha256),
					)) {
						const stream = yield* uploads.openObject({ type: asset.provider, key: asset.key });
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
					const locator = { type: provider, key } as const;
					const archive = createV1ArchiveStream({
						assets,
						archiveId: payload.runId,
						createdAt: run.createdAt,
						records: snapshot.records,
						appVersion: BACKUP_APP_VERSION,
						redactions: snapshot.redactions,
						requiredPlugins: snapshot.requiredPlugins,
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
				}),
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

		const fail = (payload: ExportBackupWorkflowPayload, artifact?: ExportArtifact) =>
			asInternal(
				Effect.gen(function* () {
					if (artifact) {
						yield* uploads
							.deleteObject({ type: artifact.provider, key: artifact.key })
							.pipe(Effect.ignore);
					}
					yield* repository.failRun({ ...payload, error: "Backup export failed" });
				}),
				"Backup export failure could not be recorded",
			);

		const provideDatabase = <A, E>(effect: Effect.Effect<A, E, Database>) =>
			effect.pipe(Effect.provideService(Database, database));
		return {
			begin: (payload) => provideDatabase(begin(payload)),
			build: (payload) => provideDatabase(build(payload)),
			complete: (payload, artifact) => provideDatabase(complete(payload, artifact)),
			fail: (payload, artifact) => provideDatabase(fail(payload, artifact)),
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
		const started = yield* Activity.make({
			name: "begin-backup-export",
			execute: operations.begin(payload),
			error: InternalError satisfies DurableSchema,
			success: Schema.Boolean satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(started)) {
			yield* Activity.make({
				execute: operations.fail(payload),
				name: "fail-unstarted-backup-export",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
			});
			return;
		}
		if (!started.success) {
			return;
		}
		const built = yield* Activity.make({
			name: "build-backup-export",
			execute: operations.build(payload),
			error: InternalError satisfies DurableSchema,
			success: ExportArtifact satisfies DurableSchema,
		}).pipe(Effect.result);
		if (Result.isFailure(built)) {
			yield* Activity.make({
				name: "fail-backup-export",
				execute: operations.fail(payload),
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
			});
			return;
		}
		const completed = yield* Activity.make({
			name: "complete-backup-export",
			success: Schema.Void satisfies DurableSchema,
			error: InternalError satisfies DurableSchema,
			execute: operations.complete(payload, built.success),
		}).pipe(Effect.result);
		if (Result.isFailure(completed)) {
			yield* Activity.make({
				name: "fail-completed-backup-export",
				success: Schema.Void satisfies DurableSchema,
				error: InternalError satisfies DurableSchema,
				execute: operations.fail(payload, built.success),
			});
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ExportBackupWorkflow" }),
);

export const ExportBackupWorkflowDefinitionsLive =
	ExportBackupWorkflow.toLayer(runExportBackupWorkflow);
