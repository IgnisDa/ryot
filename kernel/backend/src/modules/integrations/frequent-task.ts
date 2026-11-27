import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";
import { JobQueue } from "#platform/jobs/queue";

import { IntegrationSyncJob } from "./sync-job";

export const integrationsFrequentTask: CronTask<never, JobQueue> = {
	name: "integrations-sync",
	run: () =>
		Effect.flatMap(JobQueue, (jobs) =>
			jobs.enqueue(IntegrationSyncJob, { userId: null }, { key: "all" }),
		).pipe(
			Effect.catchCause((cause) => Effect.logError("integrations sync enqueue failed", cause)),
		),
};
