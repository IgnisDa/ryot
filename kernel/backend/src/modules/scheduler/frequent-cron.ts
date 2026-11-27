import { Clock, DateTime, Duration, Effect, Layer, Schema } from "effect";

import { AppConfig } from "#platform/config/service";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";

import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "./cron";

export const FrequentCronJob = makeJobKind("frequent-cron", { payload: Schema.Struct({}) });

// One queued occurrence per key, so every process can schedule it and the job runs once per interval.
export const scheduleFrequentCron = Effect.gen(function* () {
	const config = yield* AppConfig;
	if (config.scheduler.disableDispatchers) {
		return;
	}
	const queue = yield* JobQueue;
	const interval = Duration.toMillis(
		parseFrequentSchedule(config.scheduler.frequentCronJobsSchedule) ?? DEFAULT_FREQUENT_INTERVAL,
	);
	const nowMs = yield* Clock.currentTimeMillis;
	const runAt = DateTime.toDateUtc(
		DateTime.makeUnsafe((Math.floor(nowMs / interval) + 1) * interval),
	);
	yield* queue.enqueue(FrequentCronJob, {}, { runAt, key: FrequentCronJob.name });
});

export const FrequentCronSchedulerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		if (config.scheduler.disableDispatchers) {
			yield* Effect.logInfo("frequent cron scheduler disabled");
			return;
		}
		const configuredSchedule = config.scheduler.frequentCronJobsSchedule;
		if (parseFrequentSchedule(configuredSchedule) === null) {
			yield* Effect.logWarning("frequent cron schedule unsupported").pipe(
				Effect.annotateLogs({ configuredSchedule, fallback: "every 5 minutes" }),
			);
		}
		yield* scheduleFrequentCron.pipe(
			Effect.catchCause((cause) => Effect.logError("frequent cron scheduling failed", cause)),
		);
	}),
);
