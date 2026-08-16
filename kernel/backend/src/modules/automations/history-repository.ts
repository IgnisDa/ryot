import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryRun,
	type AutomationHistoryCursor,
	type AutomationHistoryFilters,
} from "@ryot-app/contract/modules/automations/history-schemas";
import { AutomationRunAttempt } from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AutomationRunId, PluginRevisionId, UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import {
	automationRun as run,
	automationRunAttempt as attempt,
	automationTrigger as trigger,
} from "#lib/infrastructure/db/schema/tables/automations";
import { pluginRevision } from "#lib/infrastructure/db/schema/tables/core";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export class AutomationHistoryRepository extends Context.Service<AutomationHistoryRepository>()(
	"AutomationHistoryRepository",
	{
		make: Effect.sync(() => {
			const summaryFields = {
				id: run.id,
				stage: run.stage,
				status: run.status,
				pluginId: run.pluginId,
				hookSlug: run.hookSlug,
				hookName: run.hookName,
				delivery: run.delivery,
				triggerId: run.triggerId,
				startedAt: run.startedAt,
				finishedAt: run.finishedAt,
				skipReason: run.skipReason,
				attemptCount: run.attemptCount,
				nextAttemptAt: run.nextAttemptAt,
				executionUserId: run.executionUserId,
				pluginRevisionId: run.pluginRevisionId,
				artifactsExpireAt: run.artifactsExpireAt,
				pluginName: sql<string | null>`${pluginRevision.manifest}->'metadata'->>'name'`,
				queuedAt: sql<string>`to_char(${run.queuedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
				triggerKind: {
					category: trigger.category,
					operation: trigger.operation,
					resource: trigger.resourceKind,
				},
			};
			const summaries = Effect.fn(function* (input: {
				userId?: UserId;
				runId?: AutomationRunId;
				filters: AutomationHistoryFilters;
				cursor: AutomationHistoryCursor | null;
				limit: number;
			}) {
				const db = yield* Database;
				const { cursor, filters } = input;
				const rows = yield* mapDatabaseErrors(
					db
						.select(summaryFields)
						.from(run)
						.innerJoin(trigger, eq(trigger.id, run.triggerId))
						.leftJoin(pluginRevision, eq(pluginRevision.id, run.pluginRevisionId))
						.where(
							and(
								input.userId === undefined ? undefined : eq(run.executionUserId, input.userId),
								input.runId === undefined ? undefined : eq(run.id, input.runId),
								filters.status === undefined ? undefined : eq(run.status, filters.status),
								filters.stage === undefined ? undefined : eq(run.stage, filters.stage),
								filters.pluginId === undefined ? undefined : eq(run.pluginId, filters.pluginId),
								filters.hookSlug === undefined ? undefined : eq(run.hookSlug, filters.hookSlug),
								filters.triggerId === undefined ? undefined : eq(run.triggerId, filters.triggerId),
								filters.from === undefined
									? undefined
									: gte(run.queuedAt, sql`${filters.from}::timestamptz`),
								filters.to === undefined
									? undefined
									: lte(run.queuedAt, sql`${filters.to}::timestamptz`),
								cursor === null
									? undefined
									: or(
											lt(run.queuedAt, sql`${cursor.queuedAt}::timestamptz`),
											and(
												eq(run.queuedAt, sql`${cursor.queuedAt}::timestamptz`),
												lt(run.id, cursor.id),
											),
										),
							),
						)
						.orderBy(desc(run.queuedAt), desc(run.id))
						.limit(input.limit),
				);
				return yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(
						{
							...row,
							startedAt: row.startedAt?.toISOString() ?? null,
							finishedAt: row.finishedAt?.toISOString() ?? null,
							artifactsExpireAt: row.artifactsExpireAt.toISOString(),
							nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
						},
						AutomationHistoryRun,
						"Invalid automation history summary",
					),
				);
			});
			const attempts = Effect.fn(function* (runId: AutomationRunId) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							id: attempt.id,
							logs: attempt.logs,
							runId: attempt.runId,
							error: attempt.error,
							status: attempt.status,
							timing: attempt.timing,
							retryable: attempt.retryable,
							startedAt: attempt.startedAt,
							finishedAt: attempt.finishedAt,
							failureKind: attempt.failureKind,
							attemptNumber: attempt.attemptNumber,
							artifactsPrunedAt: attempt.artifactsPrunedAt,
							workflowExecutionId: attempt.workflowExecutionId,
						})
						.from(attempt)
						.where(eq(attempt.runId, runId))
						.orderBy(desc(attempt.attemptNumber))
						.limit(AUTOMATION_HISTORY_LIMITS.maxAttempts + 1),
				);
				return yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(
						{
							...row,
							returnedValue: null,
							startedAt: row.startedAt.toISOString(),
							finishedAt: row.finishedAt?.toISOString() ?? null,
							artifactsPrunedAt: row.artifactsPrunedAt?.toISOString() ?? null,
						},
						AutomationRunAttempt,
						"Invalid automation history attempt",
					),
				);
			});
			const pinnedManifest = Effect.fn(function* (id: PluginRevisionId | null) {
				if (id === null) {
					return null;
				}
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ manifest: pluginRevision.manifest })
						.from(pluginRevision)
						.where(eq(pluginRevision.id, id)),
				);
				return row
					? yield* decodeStoredSchema(
							row.manifest,
							PluginManifest,
							"Invalid pinned history manifest",
						)
					: null;
			});
			return { attempts, summaries, pinnedManifest };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
