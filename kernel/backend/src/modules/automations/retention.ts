import { DbError } from "@ryot-app/contract/errors";
import { Context, DateTime, Duration, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { ScriptGarbageCollector } from "#modules/plugins/script-garbage-collector";

import { AutomationAttemptRepository } from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

export class AutomationRetention extends Context.Service<AutomationRetention>()(
	"AutomationRetention",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const runs = yield* AutomationRunRepository;
			const attempts = yield* AutomationAttemptRepository;
			const triggers = yield* AutomationTriggerRepository;
			const scriptGarbageCollector = yield* ScriptGarbageCollector;

			const runBatch = Effect.fn("AutomationRetention.runBatch")(function* (
				now: Date,
				limit: number,
			) {
				if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1) {
					return yield* new DbError({
						message: "Automation retention requires a valid time and positive integer limit",
					});
				}
				const historyBefore = DateTime.toDate(
					DateTime.subtractDuration(
						DateTime.makeUnsafe(now),
						Duration.days(config.automations.historyRetentionDays),
					),
				);
				const database = yield* Database;
				const prunedTriggers = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const pruned = yield* triggers.prunePayloads({
								limit,
								prunedAt: now,
								before: historyBefore,
							});
							yield* runs.clearHistoryPayloads(pruned.map(({ id }) => id));
							return pruned;
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				const prunedAttempts = yield* attempts.pruneArtifacts({
					limit,
					prunedAt: now,
					before: historyBefore,
				});
				const clearedScriptPins = yield* runs.clearExpiredScriptPins({ now, limit });
				const deletedRuns = yield* runs.deleteExpired({ now, limit, before: historyBefore });
				const deletedTriggers = yield* triggers.deleteExpired({ limit, before: historyBefore });
				const garbageCollection = yield* scriptGarbageCollector.collect({ now, limit });

				return {
					garbageCollection,
					deletedRuns: deletedRuns.length,
					prunedAttempts: prunedAttempts.length,
					prunedTriggers: prunedTriggers.length,
					deletedTriggers: deletedTriggers.length,
					clearedScriptPins: clearedScriptPins.length,
				};
			});

			return { runBatch };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
