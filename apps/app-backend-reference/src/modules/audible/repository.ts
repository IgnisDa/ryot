import { and, desc, eq, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";

import { DbService, dbEffect, schema } from "../../lib/db";
import { AudibleRunNotFound, DbError } from "../../lib/errors";
import {
	AudibleItemStatus,
	type AudibleImportItem,
	AudibleRunResult,
	AudibleRunStatus,
	type AudibleItem,
	type AudibleRun,
	type AudibleRunDetail,
	type AudibleRunResult as AudibleRunResultType,
	type CreateAudibleRunPayload,
	type WorkflowStep,
} from "./schemas";

type AudibleRunRow = typeof schema.audibleRun.$inferSelect;
type AudibleItemRow = typeof schema.audibleItem.$inferSelect;
type WorkflowStepRow = typeof schema.workflowStep.$inferSelect;
type AudibleScheduleRow = typeof schema.audibleSchedule.$inferSelect;

export type AudibleSchedule = {
	readonly id: string;
	readonly query: string;
	readonly intervalSeconds: number;
};

export type AudibleRunConfirmation = {
	readonly run: AudibleRun;
	readonly token: string | null;
};

const decodeRunStatus = Schema.decodeUnknownSync(AudibleRunStatus);
const decodeItemStatus = Schema.decodeUnknownSync(AudibleItemStatus);
const decodeFinalResult = Schema.decodeUnknownOption(AudibleRunResult);

const nullableString = (value: string | null | undefined) => value ?? null;

const mapRun = (row: AudibleRunRow): AudibleRun => ({
	id: row.id,
	userId: row.userId,
	query: nullableString(row.query),
	status: decodeRunStatus(row.status),
	uploadId: nullableString(row.uploadId),
	executionId: nullableString(row.executionId),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

const mapItem = (row: AudibleItemRow): AudibleItem => ({
	id: row.id,
	asin: nullableString(row.asin),
	query: row.query,
	title: nullableString(row.title),
	author: nullableString(row.author),
	status: decodeItemStatus(row.status),
	details: row.details ?? null,
	imageUrl: nullableString(row.imageUrl),
	sourceUrl: nullableString(row.sourceUrl),
	createdAt: row.createdAt.toISOString(),
});

const mapStep = (row: WorkflowStepRow): WorkflowStep => ({
	id: row.id,
	name: row.name,
	status: row.status,
	details: row.details ?? null,
	createdAt: row.createdAt.toISOString(),
});

const mapSchedule = (row: AudibleScheduleRow): AudibleSchedule => ({
	id: row.id,
	query: row.query,
	intervalSeconds: row.intervalSeconds,
});

const mapFinalResult = (value: unknown): AudibleRunResultType | null =>
	Option.getOrNull(decodeFinalResult(value));

export class AudibleRepository extends Effect.Service<AudibleRepository>()("AudibleRepository", {
	effect: Effect.gen(function* () {
		const { db } = yield* DbService;

		const readDetail = (
			run: AudibleRun,
			workflowPoll: string | null,
		): Effect.Effect<AudibleRunDetail, DbError> =>
			Effect.gen(function* () {
				const items = yield* dbEffect(() =>
					db
						.select()
						.from(schema.audibleItem)
						.where(eq(schema.audibleItem.runId, run.id))
						.orderBy(desc(schema.audibleItem.createdAt)),
				);
				const steps = yield* dbEffect(() =>
					db
						.select()
						.from(schema.workflowStep)
						.where(eq(schema.workflowStep.runId, run.id))
						.orderBy(desc(schema.workflowStep.createdAt)),
				);
				const [row] = yield* dbEffect(() =>
					db.select().from(schema.audibleRun).where(eq(schema.audibleRun.id, run.id)).limit(1),
				);

				return {
					run: row ? mapRun(row) : run,
					items: items.map(mapItem),
					steps: steps.map(mapStep),
					workflowPoll,
					finalResult: mapFinalResult(row?.finalResult),
				};
			});

		const readDetailOrNotFound = (
			row: AudibleRunRow | undefined,
			runId: string,
			workflowPoll: string | null,
		): Effect.Effect<AudibleRunDetail, DbError | AudibleRunNotFound> =>
			row
				? readDetail(mapRun(row), workflowPoll)
				: Effect.fail(new AudibleRunNotFound({ id: runId }));

		return {
			addStep: (runId: string, name: string, status: string, details?: unknown) =>
				dbEffect(() =>
					db
						.insert(schema.workflowStep)
						.values({ runId, name, status, details: details ?? null })
						.returning(),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? Effect.succeed(mapStep(row))
							: Effect.fail(new DbError({ message: "Workflow step insert returned no row" })),
					),
				),
			cleanupItems: (runId: string) =>
				dbEffect(() =>
					db.delete(schema.audibleItem).where(eq(schema.audibleItem.runId, runId)),
				).pipe(Effect.asVoid),
			createRun: (userId: string, input: CreateAudibleRunPayload) =>
				dbEffect(() =>
					db
						.insert(schema.audibleRun)
						.values({
							userId,
							query: input.query?.trim() ?? null,
							status: "queued",
							uploadId: input.uploadId?.trim() ?? null,
						})
						.returning(),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? dbEffect(() =>
									db
										.update(schema.audibleRun)
										.set({ executionId: row.id, updatedAt: sql`now()` })
										.where(eq(schema.audibleRun.id, row.id))
										.returning(),
								).pipe(
									Effect.flatMap(([updated]) =>
										updated
											? Effect.succeed(mapRun(updated))
											: Effect.fail(new DbError({ message: "Audible run update returned no row" })),
									),
								)
							: Effect.fail(new DbError({ message: "Audible run insert returned no row" })),
					),
				),
			createSchedulerRun: (query: string) =>
				dbEffect(() =>
					db
						.insert(schema.audibleRun)
						.values({ userId: "scheduler", query, status: "queued" })
						.returning(),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? dbEffect(() =>
									db
										.update(schema.audibleRun)
										.set({ executionId: row.id, updatedAt: sql`now()` })
										.where(eq(schema.audibleRun.id, row.id))
										.returning(),
								).pipe(
									Effect.flatMap(([updated]) =>
										updated
											? Effect.succeed(mapRun(updated))
											: Effect.fail(
													new DbError({ message: "Scheduled run update returned no row" }),
												),
									),
								)
							: Effect.fail(new DbError({ message: "Scheduled run insert returned no row" })),
					),
				),
			expireImport: (runId: string) =>
				dbEffect(() =>
					db
						.update(schema.audibleRun)
						.set({ confirmationToken: null, status: "expired", updatedAt: sql`now()` })
						.where(eq(schema.audibleRun.id, runId)),
				).pipe(Effect.asVoid),
			getConfirmationToken: (userId: string, runId: string) =>
				dbEffect(() =>
					db
						.select()
						.from(schema.audibleRun)
						.where(and(eq(schema.audibleRun.id, runId), eq(schema.audibleRun.userId, userId)))
						.limit(1),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? Effect.succeed({
									run: mapRun(row),
									token: row.confirmationToken ?? null,
								})
							: Effect.fail(new AudibleRunNotFound({ id: runId })),
					),
				),
			getDetail: (userId: string, runId: string, workflowPoll: string | null = null) =>
				dbEffect(() =>
					db
						.select()
						.from(schema.audibleRun)
						.where(and(eq(schema.audibleRun.id, runId), eq(schema.audibleRun.userId, userId)))
						.limit(1),
				).pipe(Effect.flatMap(([row]) => readDetailOrNotFound(row, runId, workflowPoll))),
			getRunById: (runId: string) =>
				dbEffect(() =>
					db.select().from(schema.audibleRun).where(eq(schema.audibleRun.id, runId)).limit(1),
				).pipe(
					Effect.flatMap(([row]) =>
						row ? Effect.succeed(mapRun(row)) : Effect.fail(new AudibleRunNotFound({ id: runId })),
					),
				),
			listEnabledSchedules: () =>
				dbEffect(() =>
					db.select().from(schema.audibleSchedule).where(eq(schema.audibleSchedule.enabled, true)),
				).pipe(Effect.map((rows) => rows.map(mapSchedule))),
			listForUser: (userId: string) =>
				dbEffect(() =>
					db
						.select()
						.from(schema.audibleRun)
						.where(eq(schema.audibleRun.userId, userId))
						.orderBy(desc(schema.audibleRun.createdAt)),
				).pipe(Effect.map((rows) => rows.map(mapRun))),
			saveFinalResult: (runId: string, result: AudibleRunResultType) =>
				dbEffect(() =>
					db
						.update(schema.audibleRun)
						.set({
							finalResult: result,
							status: "completed",
							updatedAt: sql`now()`,
							confirmationToken: null,
						})
						.where(eq(schema.audibleRun.id, runId)),
				).pipe(Effect.asVoid),
			saveConfirmationToken: (runId: string, token: string) =>
				dbEffect(() =>
					db
						.update(schema.audibleRun)
						.set({
							confirmationToken: token,
							status: "awaiting_confirmation",
							updatedAt: sql`now()`,
						})
						.where(eq(schema.audibleRun.id, runId)),
				).pipe(Effect.asVoid),
			updateStatus: (runId: string, status: typeof AudibleRunStatus.Type) =>
				dbEffect(() =>
					db
						.update(schema.audibleRun)
						.set({ status, updatedAt: sql`now()` })
						.where(eq(schema.audibleRun.id, runId)),
				).pipe(Effect.asVoid),
			upsertItem: (runId: string, item: AudibleImportItem) =>
				dbEffect(() =>
					db
						.insert(schema.audibleItem)
						.values({
							runId,
							asin: item.asin,
							query: item.query,
							title: item.title,
							author: item.author,
							status: item.status,
							details: item.details,
							imageUrl: item.imageUrl,
							sourceUrl: item.sourceUrl,
						})
						.onConflictDoUpdate({
							target: [schema.audibleItem.runId, schema.audibleItem.query],
							set: {
								asin: item.asin,
								title: item.title,
								author: item.author,
								status: item.status,
								details: item.details,
								imageUrl: item.imageUrl,
								sourceUrl: item.sourceUrl,
							},
						})
						.returning(),
				).pipe(
					Effect.flatMap(([row]) =>
						row
							? Effect.succeed(mapItem(row))
							: Effect.fail(new DbError({ message: "Audible item upsert returned no row" })),
					),
				),
		};
	}),
}) {}
