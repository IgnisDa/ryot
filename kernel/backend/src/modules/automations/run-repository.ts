import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationRunSkipReason,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationRunId, AutomationTriggerId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { automationRun as table } from "#lib/infrastructure/db/schema/tables/automations";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

const policyChainStopped = Schema.decodeSync(AutomationRunSkipReason)({
	code: "policy-chain-stopped",
});

const decodeRow = (row: typeof table.$inferSelect) =>
	decodeStoredSchema(
		{
			...row,
			queuedAt: row.queuedAt.toISOString(),
			startedAt: row.startedAt?.toISOString() ?? null,
			finishedAt: row.finishedAt?.toISOString() ?? null,
			artifactsExpireAt: row.artifactsExpireAt.toISOString(),
			nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
		},
		AutomationRun,
		`Invalid automation run ${row.id}`,
	);

const immutableFields = (run: AutomationRun) => ({
	id: run.id,
	stage: run.stage,
	pluginId: run.pluginId,
	hookSlug: run.hookSlug,
	hookName: run.hookName,
	delivery: run.delivery,
	queuedAt: run.queuedAt,
	triggerId: run.triggerId,
	scriptSlug: run.scriptSlug,
	retryPolicy: run.retryPolicy,
	executionUserId: run.executionUserId,
	pluginRevisionId: run.pluginRevisionId,
	scriptContentHash: run.scriptContentHash,
	artifactsExpireAt: run.artifactsExpireAt,
	pluginConfigRevisionId: run.pluginConfigRevisionId,
});

export class AutomationRunRepository extends Context.Service<AutomationRunRepository>()(
	"AutomationRunRepository",
	{
		make: Effect.sync(() => {
			const findById = Effect.fn(function* (id: AutomationRunId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(db.select().from(table).where(eq(table.id, id)));
				return row ? yield* decodeRow(row) : null;
			});
			const insertQueued = Effect.fn(function* (input: AutomationRun) {
				const value = yield* decodeStoredSchema(
					input,
					AutomationRun,
					"Invalid queued automation run",
				);
				if (
					value.status !== "queued" ||
					value.attemptCount !== 0 ||
					value.startedAt !== null ||
					value.finishedAt !== null ||
					value.nextAttemptAt !== null ||
					value.skipReason !== null ||
					value.sandboxScriptId === null
				) {
					return yield* new DbError({
						message:
							"New automation runs must be queued with a pinned script and no execution state",
					});
				}
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db
						.insert(table)
						.values({
							...value,
							startedAt: null,
							finishedAt: null,
							nextAttemptAt: null,
							queuedAt: DateTime.toDate(DateTime.makeUnsafe(value.queuedAt)),
							artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe(value.artifactsExpireAt)),
						})
						.onConflictDoNothing(),
				);
				const stored = yield* findById(value.id);
				if (
					!stored ||
					stableStringify(immutableFields(stored)) !== stableStringify(immutableFields(value)) ||
					(stored.sandboxScriptId !== null && stored.sandboxScriptId !== value.sandboxScriptId)
				) {
					return yield* new DbError({ message: `Automation run identity conflict: ${value.id}` });
				}
				return stored;
			});
			const listByTrigger = Effect.fn(function* (triggerId: AutomationTriggerId) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(table)
						.where(eq(table.triggerId, triggerId))
						.orderBy(asc(table.queuedAt), asc(table.id)),
				);
				return yield* Effect.forEach(rows, decodeRow);
			});
			const listQueuedCandidates = Effect.fn(function* (input: { now: Date; limit: number }) {
				if (
					!Number.isSafeInteger(input.limit) ||
					input.limit < 1 ||
					!Number.isFinite(input.now.getTime())
				) {
					return yield* new DbError({
						message: "Queued candidate query requires a valid time and positive integer limit",
					});
				}
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(table)
						.where(
							and(
								eq(table.status, "queued"),
								eq(table.stage, "after"),
								lte(table.queuedAt, input.now),
								or(isNull(table.nextAttemptAt), lte(table.nextAttemptAt, input.now)),
							),
						)
						.orderBy(asc(table.queuedAt), asc(table.id))
						.limit(input.limit),
				);
				return yield* Effect.forEach(rows, decodeRow);
			});
			const skipQueuedPolicies = Effect.fn(function* (input: { triggerId: AutomationTriggerId }) {
				const db = yield* Database;
				const queuedPolicy = and(
					eq(table.triggerId, input.triggerId),
					eq(table.stage, "before"),
					eq(table.status, "queued"),
					eq(table.attemptCount, 0),
				);
				return yield* mapDatabaseErrors(
					db.transaction((transaction) =>
						Effect.gen(function* () {
							const rows = yield* transaction
								.select({ id: table.id })
								.from(table)
								.where(queuedPolicy)
								.orderBy(asc(table.id))
								.for("update");
							if (rows.length === 0) {
								return;
							}
							const finishedAt = DateTime.toDate(yield* DateTime.now);
							yield* transaction
								.update(table)
								.set({ finishedAt, status: "skipped", skipReason: policyChainStopped })
								.where(
									and(
										queuedPolicy,
										inArray(
											table.id,
											rows.map(({ id }) => id),
										),
									),
								);
						}),
					),
				);
			});
			const clearExpiredScriptPins = Effect.fn(function* (input: { now: Date; limit: number }) {
				const db = yield* Database;
				const expiredTerminal = and(
					isNotNull(table.sandboxScriptId),
					lte(table.artifactsExpireAt, input.now),
					isNull(table.nextAttemptAt),
					notInArray(table.status, ["queued", "running"]),
				);
				const candidates = db
					.select({ id: table.id })
					.from(table)
					.where(expiredTerminal)
					.orderBy(asc(table.artifactsExpireAt), asc(table.id))
					.limit(input.limit);
				return yield* mapDatabaseErrors(
					db
						.update(table)
						.set({ sandboxScriptId: null })
						.where(and(inArray(table.id, candidates), expiredTerminal))
						.returning({ id: table.id }),
				);
			});
			const deleteExpired = Effect.fn(function* (input: {
				now: Date;
				before: Date;
				limit: number;
			}) {
				const db = yield* Database;
				const expiredHistory = and(
					lte(table.queuedAt, input.before),
					lte(table.artifactsExpireAt, input.now),
					isNull(table.nextAttemptAt),
					notInArray(table.status, ["queued", "running"]),
				);
				const candidates = db
					.select({ id: table.id })
					.from(table)
					.where(expiredHistory)
					.orderBy(asc(table.queuedAt), asc(table.id))
					.limit(input.limit);
				return yield* mapDatabaseErrors(
					db
						.delete(table)
						.where(and(inArray(table.id, candidates), expiredHistory))
						.returning({ id: table.id }),
				);
			});
			return {
				findById,
				insertQueued,
				deleteExpired,
				listByTrigger,
				skipQueuedPolicies,
				listQueuedCandidates,
				clearExpiredScriptPins,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
