import { Duration, Effect, Layer, Schedule } from "effect";

import { AppConfig } from "#lib/config";

import { IntegrationsService } from "./service";

const defaultInterval = Duration.minutes(5);

const parseFrequentSchedule = (value: string | undefined) => {
	if (!value) {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "every minute") {
		return Duration.minutes(1);
	}
	if (normalized === "every hour") {
		return Duration.hours(1);
	}

	const match = normalized.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours)$/);
	if (!match) {
		return null;
	}

	const amountText = match[1];
	const unit = match[2];
	if (!amountText || !unit) {
		return null;
	}

	const amount = Number.parseInt(amountText, 10);
	if (!Number.isFinite(amount) || amount <= 0) {
		return null;
	}

	return unit.startsWith("hour") ? Duration.hours(amount) : Duration.minutes(amount);
};

export const IntegrationsSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
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
			Effect.repeat(Schedule.spaced(interval ?? defaultInterval)),
			Effect.forkScoped,
		);
	}),
);
