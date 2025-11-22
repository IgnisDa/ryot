import { Effect, Layer, Schedule } from "effect";

import { AppConfig } from "#lib/config/service";
import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "#modules/scheduler/cron";

import { IntegrationsService } from "./service";

export const IntegrationsSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("Background jobs disabled; skipping integrations scheduler");
			return;
		}

		const service = yield* IntegrationsService;
		const configuredSchedule = config.scheduler.frequentCronJobsSchedule;

		const interval = parseFrequentSchedule(configuredSchedule);
		if (interval === null) {
			yield* Effect.logWarning(
				`Unsupported SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE '${configuredSchedule}', defaulting to every 5 minutes`,
			);
		}

		yield* service.reconcileScheduledYankRuns().pipe(
			Effect.catchAll((error) =>
				Effect.logError(`Integration reconciliation failed: ${error.message}`),
			),
			Effect.repeat(Schedule.spaced(interval ?? DEFAULT_FREQUENT_INTERVAL)),
			Effect.forkScoped,
		);
	}),
);
