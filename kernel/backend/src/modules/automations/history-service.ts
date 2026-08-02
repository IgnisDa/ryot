import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	AutomationHistoryInternalError,
	AutomationHistoryNotFound,
	AutomationHistoryRetryConflict,
	type AutomationHistoryRetryBody,
	type AutomationHistoryRetryResult,
} from "@ryot-app/contract/modules/automations/history-schemas";
import type { AutomationRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, DateTime, Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationExecutionOperations } from "./execution";
import { AutomationHistoryRepository } from "./history-repository";

const internalError = () =>
	new AutomationHistoryInternalError({ reason: { code: "history-unavailable" } });

export class AutomationHistoryService extends Context.Service<AutomationHistoryService>()(
	"AutomationHistoryService",
	{
		make: Effect.gen(function* () {
			const history = yield* AutomationHistoryRepository;
			const attempts = yield* AutomationAttemptRepository;
			const execution = yield* AutomationExecutionOperations;
			const database = yield* Database;
			const persisted = <A, E>(effect: Effect.Effect<A, E, Database>) =>
				effect.pipe(Effect.provideService(Database, database));
			const requireRun = Effect.fn(function* (userId: UserId, runId: AutomationRunId) {
				const run = yield* history.findOwnedRun(userId, runId);
				if (!run) {
					return yield* new AutomationHistoryNotFound({ reason: { runId, code: "run-not-found" } });
				}
				return run;
			});
			const retry = Effect.fn(function* (
				userId: UserId,
				runId: AutomationRunId,
				body: AutomationHistoryRetryBody,
			) {
				const run = yield* persisted(requireRun(userId, runId));
				const now = DateTime.toDate(yield* DateTime.now);
				const reason = yield* persisted(attempts.retryEligibility(runId, now));
				if (reason !== null) {
					return yield* new AutomationHistoryRetryConflict({ reason: { runId, code: reason } });
				}
				if (run.attemptCount !== body.expectedAttemptCount) {
					return yield* new AutomationHistoryRetryConflict({
						reason: { runId, code: "retry-conflict" },
					});
				}
				const queued = yield* persisted(
					attempts.queueRetry({ now, runId, expectedAttemptCount: body.expectedAttemptCount }),
				).pipe(
					Effect.mapError(
						() => new AutomationHistoryRetryConflict({ reason: { runId, code: "retry-conflict" } }),
					),
				);
				const dispatch = yield* execution
					.submit({ runId, acceptedPatches: [], attemptNumber: queued.attemptNumber })
					.pipe(
						Effect.timeout("5 seconds"),
						Effect.as("submitted" as const),
						Effect.catchCause((cause) =>
							Cause.hasInterruptsOnly(cause)
								? Effect.interrupt
								: Effect.succeed("pending" as const),
						),
					);
				return {
					runId,
					dispatch,
					attemptNumber: queued.attemptNumber,
				} satisfies AutomationHistoryRetryResult;
			});
			return {
				retryRun: (
					user: CurrentUserValue,
					runId: AutomationRunId,
					body: AutomationHistoryRetryBody,
				) =>
					retry(user.id, runId, body).pipe(
						Effect.catchTag("DbError", () => Effect.fail(internalError())),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
