import { DbError } from "@ryot-app/contract/errors";
import {
	BackupConflict,
	type BackupRunArtifactProvider,
	type BackupRunFailure,
	type BackupRunKind,
} from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId, UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, lte, notInArray } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/backups";
import {
	Database,
	isUniqueConstraintError,
	mapDatabaseErrors,
} from "#lib/infrastructure/db/service";

type BackupRunRow = typeof schema.backupRun.$inferSelect;

type BackupRunArtifactRecord = ReturnType<typeof normalizeRun> & {
	readonly userId: UserId;
	readonly artifactKey: string;
	readonly artifactProvider: BackupRunArtifactProvider;
};

const normalizeRun = (row: BackupRunRow) => ({
	kind: row.kind,
	status: row.status,
	failure: row.failure,
	progress: row.progress,
	id: BackupRunId.make(row.id),
	artifactProvider: row.artifactProvider,
	createdAt: row.createdAt.toISOString(),
	expiresAt: row.expiresAt?.toISOString() ?? null,
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
});

const normalizeArtifact = (row: BackupRunRow): BackupRunArtifactRecord | null => {
	if (row.artifactProvider === null || row.artifactKey === null || row.expiresAt === null) {
		return null;
	}

	return {
		...normalizeRun(row),
		artifactKey: row.artifactKey,
		userId: UserId.make(row.userId),
		artifactProvider: row.artifactProvider,
	};
};

const boundedProgress = (progress: number) =>
	Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.trunc(progress))) : 0;

export class BackupsRepository extends Context.Service<BackupsRepository>()("BackupsRepository", {
	make: Effect.sync(() => {
		const createRun = Effect.fn("BackupsRepository.createRun")(function* (input: {
			userId: UserId;
			kind: BackupRunKind;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.insert(schema.backupRun)
					.values({ progress: 0, kind: input.kind, status: "pending", userId: input.userId })
					.returning(),
			).pipe(
				Effect.catchIf(isUniqueConstraintError("backup_run_user_active_unique"), () =>
					Effect.fail(new BackupConflict({ reason: { code: "active-run-exists" } })),
				),
			);
			if (!row) {
				return yield* new DbError({ message: "Backup run insert returned no row" });
			}
			return normalizeRun(row);
		});

		const getRunById = Effect.fn("BackupsRepository.getRunById")(function* (input: {
			userId: UserId;
			runId: BackupRunId;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.backupRun)
					.where(
						and(eq(schema.backupRun.id, input.runId), eq(schema.backupRun.userId, input.userId)),
					)
					.limit(1),
			);
			return row ? normalizeRun(row) : null;
		});

		const getArtifactById = Effect.fn("BackupsRepository.getArtifactById")(function* (input: {
			runId: BackupRunId;
			userId: UserId;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.backupRun)
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							eq(schema.backupRun.status, "completed"),
							isNotNull(schema.backupRun.artifactProvider),
							isNotNull(schema.backupRun.artifactKey),
						),
					)
					.limit(1),
			);
			return row ? normalizeArtifact(row) : null;
		});

		const markRunRunning = Effect.fn("BackupsRepository.markRunRunning")(function* (input: {
			userId: UserId;
			progress?: number;
			runId: BackupRunId;
		}) {
			const db = yield* Database;
			const startedAt = yield* DateTime.nowAsDate;
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.backupRun)
					.set({ startedAt, status: "running", progress: boundedProgress(input.progress ?? 0) })
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							eq(schema.backupRun.status, "pending"),
						),
					)
					.returning(),
			);
			if (row) {
				return normalizeRun(row);
			}
			const existing = yield* getRunById(input);
			return existing?.status === "running" ? existing : null;
		});

		const updateProgress = Effect.fn("BackupsRepository.updateProgress")(function* (input: {
			runId: BackupRunId;
			userId: UserId;
			progress: number;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.backupRun)
					.set({ progress: boundedProgress(input.progress) })
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							eq(schema.backupRun.status, "running"),
						),
					)
					.returning(),
			);
			return row ? normalizeRun(row) : null;
		});

		const completeRun = Effect.fn("BackupsRepository.completeRun")(function* (
			input:
				| { runId: BackupRunId; userId: UserId }
				| {
						userId: UserId;
						expiresAt: Date;
						runId: BackupRunId;
						artifactKey: string;
						artifactProvider: BackupRunArtifactProvider;
				  },
		) {
			const db = yield* Database;
			const finishedAt = yield* DateTime.nowAsDate;
			const artifact =
				"artifactKey" in input
					? {
							expiresAt: input.expiresAt,
							artifactKey: input.artifactKey,
							artifactProvider: input.artifactProvider,
						}
					: { expiresAt: null, artifactKey: null, artifactProvider: null };
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.backupRun)
					.set({ status: "completed", ...artifact, finishedAt, progress: 100 })
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							eq(schema.backupRun.status, "running"),
						),
					)
					.returning(),
			);
			return row ? normalizeRun(row) : null;
		});

		const failRun = Effect.fn("BackupsRepository.failRun")(function* (input: {
			failure: BackupRunFailure;
			userId: UserId;
			runId: BackupRunId;
		}) {
			const db = yield* Database;
			const finishedAt = yield* DateTime.nowAsDate;
			const [row] = yield* mapDatabaseErrors(
				db
					.update(schema.backupRun)
					.set({ finishedAt, status: "failed", failure: input.failure })
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							inArray(schema.backupRun.status, ["pending", "running"]),
						),
					)
					.returning(),
			);
			return row ? normalizeRun(row) : null;
		});

		const listExpiredArtifacts = Effect.fn("BackupsRepository.listExpiredArtifacts")(
			function* (input: { limit: number }) {
				const limit = Number.isFinite(input.limit) ? Math.max(0, Math.trunc(input.limit)) : 0;
				if (limit === 0) {
					return [];
				}
				const db = yield* Database;
				const now = yield* DateTime.nowAsDate;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.backupRun)
						.where(
							and(
								eq(schema.backupRun.status, "completed"),
								lte(schema.backupRun.expiresAt, now),
								isNotNull(schema.backupRun.artifactProvider),
								isNotNull(schema.backupRun.artifactKey),
							),
						)
						.orderBy(asc(schema.backupRun.expiresAt), asc(schema.backupRun.id))
						.limit(limit),
				);
				return rows.flatMap((row) => {
					const artifact = normalizeArtifact(row);
					return artifact ? [artifact] : [];
				});
			},
		);

		const deleteRunById = Effect.fn("BackupsRepository.deleteRunById")(function* (input: {
			userId: UserId;
			runId: BackupRunId;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.delete(schema.backupRun)
					.where(
						and(
							eq(schema.backupRun.id, input.runId),
							eq(schema.backupRun.userId, input.userId),
							notInArray(schema.backupRun.status, ["pending", "running"]),
						),
					)
					.returning(),
			);
			return row ? normalizeRun(row) : null;
		});

		const deleteExpiredRunById = Effect.fn("BackupsRepository.deleteExpiredRunById")(
			function* (input: { runId: BackupRunId }) {
				const db = yield* Database;
				const now = yield* DateTime.nowAsDate;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.backupRun)
						.where(
							and(
								eq(schema.backupRun.id, input.runId),
								eq(schema.backupRun.status, "completed"),
								lte(schema.backupRun.expiresAt, now),
							),
						)
						.returning(),
				);
				return row ? normalizeRun(row) : null;
			},
		);

		return {
			failRun,
			createRun,
			getRunById,
			completeRun,
			deleteRunById,
			markRunRunning,
			updateProgress,
			getArtifactById,
			deleteExpiredRunById,
			listExpiredArtifacts,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
