import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Clock, Cron, Duration, Effect, Either, Layer } from "effect";

import { AppConfig } from "#lib/config/service";

import { DEFAULT_INFREQUENT_CRON, parseInfrequentCron } from "./cron";
import { InfrequentCronWorkflow } from "./cron-workflow";

export const InfrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("Background jobs disabled; skipping infrequent cron scheduler");
			return;
		}

		const engine = yield* WorkflowEngine;

		const parsed = parseInfrequentCron(
			config.scheduler.infrequentCronJobsSchedule,
			config.timezone,
		);
		if (Either.isLeft(parsed)) {
			yield* Effect.logWarning(
				`Invalid SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE '${config.scheduler.infrequentCronJobsSchedule}', defaulting to midnight`,
			);
		}
		const cron = Either.getOrElse(parsed, () =>
			Either.getOrThrow(Cron.parse(DEFAULT_INFREQUENT_CRON, config.timezone)),
		);

		// fire only at each cron instant (no forced boot run)
		const tick = Effect.gen(function* () {
			const nowMs = yield* Clock.currentTimeMillis;
			const nextMs = Cron.next(cron, nowMs).getTime();
			yield* Effect.sleep(Duration.millis(Math.max(0, nextMs - nowMs)));

			const executionId = `infrequent-cron-${nextMs}`;
			yield* engine
				.execute(InfrequentCronWorkflow, {
					executionId,
					discard: true,
					payload: { executionId },
				})
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError(
							`Failed to enqueue infrequent cron run: ${unknownToMessage(Cause.squash(cause))}`,
						),
					),
				);
		});

		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
