import { AUTOMATION_HISTORY_LIMITS } from "@ryot-app/contract/modules/automations/history-schemas";
import { AutomationRunAttempt } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationRunId, UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { desc, eq, and } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import {
	automationRun as run,
	automationRunAttempt as attempt,
} from "#lib/infrastructure/db/schema/tables/automations";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

export class AutomationHistoryRepository extends Context.Service<AutomationHistoryRepository>()(
	"AutomationHistoryRepository",
	{
		make: Effect.sync(() => {
			const findOwnedRun = Effect.fn(function* (userId: UserId, runId: AutomationRunId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ attemptCount: run.attemptCount })
						.from(run)
						.where(and(eq(run.id, runId), eq(run.executionUserId, userId))),
				);
				return row ?? null;
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
			return { attempts, findOwnedRun };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
