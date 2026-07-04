import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { Effect, Layer, Schedule } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { DEFAULT_FREQUENT_INTERVAL, parseFrequentSchedule } from "./cron";
import { FrequentCronWorkflow } from "./cron-workflow";

export const FrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
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

		const enqueueRun = Effect.gen(function* () {
			const executionId = `frequent-cron-${generateId()}`;
			yield* engine
				.execute(FrequentCronWorkflow, {
					executionId,
					discard: true,
					payload: { executionId },
				})
				.pipe(
					Effect.catchAllCause((cause) => Effect.logError("frequent cron enqueue failed", cause)),
				);
		});

		yield* enqueueRun.pipe(
			Effect.repeat(Schedule.spaced(interval ?? DEFAULT_FREQUENT_INTERVAL)),
			Effect.forkScoped,
		);
	}),
);
