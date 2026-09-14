import { Clock, Duration, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";

import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "./cron";
import { FrequentCronWorkflow } from "./cron-workflow";

export const frequentCronExecutionId = (intervalMs: number, scheduledAt: number) =>
	`frequent-cron-${intervalMs}-${scheduledAt}`;

export const FrequentCronSchedulerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.scheduler.disableDispatchers) {
			yield* Effect.logInfo("frequent cron scheduler disabled");
			return;
		}

		const engine = yield* WorkflowEngine;

		const configuredSchedule = config.scheduler.frequentCronJobsSchedule;
		const interval = parseFrequentSchedule(configuredSchedule);
		if (interval === null) {
			yield* Effect.logWarning("frequent cron schedule unsupported").pipe(
				Effect.annotateLogs({ configuredSchedule, fallback: "every 5 minutes" }),
			);
		}
		const intervalMs = Duration.toMillis(interval ?? DEFAULT_FREQUENT_INTERVAL);

		// Every replica sleeps to the same interval boundary and derives the execution id from it, so
		// one occurrence enqueues one durable workflow no matter how many processes run the scheduler
		// or when they started.
		const tick = Effect.gen(function* () {
			const nowMs = yield* Clock.currentTimeMillis;
			const scheduledAt = (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
			yield* Effect.sleep(Duration.millis(scheduledAt - nowMs));
			const executionId = frequentCronExecutionId(intervalMs, scheduledAt);
			yield* engine
				.execute(FrequentCronWorkflow, { executionId, discard: true, payload: { executionId } })
				.pipe(Effect.catchCause((cause) => Effect.logError("frequent cron enqueue failed", cause)));
		});

		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
