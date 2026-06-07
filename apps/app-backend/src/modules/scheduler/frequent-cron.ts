import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { Cause, Effect, Layer, Schedule } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "./cron";
import { FrequentCronWorkflow } from "./cron-workflow";

export const FrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("Background jobs disabled; skipping frequent cron scheduler");
			return;
		}

		const engine = yield* WorkflowEngine;

		const configuredSchedule = config.scheduler.frequentCronJobsSchedule;
		const interval = parseFrequentSchedule(configuredSchedule);
		if (interval === null) {
			yield* Effect.logWarning(
				`Unsupported SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE '${configuredSchedule}', defaulting to every 5 minutes`,
			);
		}

		const enqueueRun = Effect.gen(function* () {
			const executionId = `frequent-cron-${generateId()}`;
			yield* engine
				.execute(FrequentCronWorkflow, {
					executionId,
					discard: true,
					payload: { executionId },
				})
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError(
							`Failed to enqueue frequent cron run: ${unknownToMessage(Cause.squash(cause))}`,
						),
					),
				);
		});

		yield* enqueueRun.pipe(
			Effect.repeat(Schedule.spaced(interval ?? DEFAULT_FREQUENT_INTERVAL)),
			Effect.forkScoped,
		);
	}),
);
