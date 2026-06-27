import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Clock, Cron, Duration, Effect, Either, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { DEFAULT_INFREQUENT_CRON, parseInfrequentCron } from "./cron";
import { InfrequentCronWorkflow } from "./cron-workflow";

export const InfrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("infrequent cron scheduler disabled");
			return;
		}

		const engine = yield* WorkflowEngine;

		const parsed = parseInfrequentCron(
			config.scheduler.infrequentCronJobsSchedule,
			config.timezone,
		);
		if (Either.isLeft(parsed)) {
			yield* Effect.logWarning("infrequent cron schedule invalid").pipe(
				Effect.annotateLogs({
					fallback: "every midnight",
					configuredSchedule: config.scheduler.infrequentCronJobsSchedule,
				}),
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
					Effect.withSpan("InfrequentCronWorkflow.dispatch", {
						attributes: { executionId },
					}),
					Effect.catchAllCause((cause) => Effect.logError("infrequent cron enqueue failed", cause)),
				);
		});

		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
