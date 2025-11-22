import { unknownToMessage } from "@ryot/contract/errors";
import { Cause, Clock, Cron, Duration, Effect, Either, Layer } from "effect";

import { AppConfig } from "#lib/config/service";
import { mediaTrendingInfrequentTask } from "#modules/media-trending/infrequent-task";

import { DEFAULT_INFREQUENT_CRON, parseInfrequentCron } from "./cron";
import type { InfrequentCronTask } from "./types";

const infrequentCronTasks: ReadonlyArray<InfrequentCronTask> = [mediaTrendingInfrequentTask];

const runAllInfrequentTasks = Effect.forEach(
	infrequentCronTasks,
	(task) =>
		task.run.pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError(
					`Infrequent cron task '${task.name}' failed: ${unknownToMessage(Cause.squash(cause))}`,
				),
			),
		),
	{ discard: true },
);

export const InfrequentCronSchedulerLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;

		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("Background jobs disabled; skipping infrequent cron scheduler");
			return;
		}

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
			const waitMs = Cron.next(cron, nowMs).getTime() - nowMs;
			yield* Effect.sleep(Duration.millis(Math.max(0, waitMs)));
			yield* runAllInfrequentTasks;
		});

		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
