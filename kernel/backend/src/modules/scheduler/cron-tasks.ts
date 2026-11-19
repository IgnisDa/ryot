import { Effect } from "effect";

import type { CronTask, CronTaskContext } from "./types";

export const runTasks = <E, R>(tasks: ReadonlyArray<CronTask<E, R>>, ctx: CronTaskContext) =>
	Effect.forEach(
		tasks,
		(task) =>
			task
				.run(ctx)
				.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("cron task failed", cause).pipe(
							Effect.annotateLogs({ task: task.name }),
						),
					),
				),
		{ discard: true },
	);
