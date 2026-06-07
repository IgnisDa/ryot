import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Effect, Layer, Schedule } from "effect";

import { AppConfig } from "#lib/config/service";
import {
	type FrequentCronTask,
	integrationsFrequentTask,
} from "#modules/integrations/frequent-task";

import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "./cron";

const frequentCronTasks: ReadonlyArray<FrequentCronTask> = [integrationsFrequentTask];

const runAllFrequentTasks = Effect.forEach(
	frequentCronTasks,
	(task) =>
		task.run.pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError(
					`Frequent cron task '${task.name}' failed: ${unknownToMessage(Cause.squash(cause))}`,
				),
			),
		),
	{ discard: true },
);

export const FrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("Background jobs disabled; skipping frequent cron scheduler");
			return;
		}

		const configuredSchedule = config.scheduler.frequentCronJobsSchedule;
		const interval = parseFrequentSchedule(configuredSchedule);
		if (interval === null) {
			yield* Effect.logWarning(
				`Unsupported SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE '${configuredSchedule}', defaulting to every 5 minutes`,
			);
		}

		yield* runAllFrequentTasks.pipe(
			Effect.repeat(Schedule.spaced(interval ?? DEFAULT_FREQUENT_INTERVAL)),
			Effect.forkScoped,
		);
	}),
);
