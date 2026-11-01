import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { UserLifecycleService } from "./service";

export const userLifecycleFrequentTask: CronTask<never, UserLifecycleService> = {
	name: "user-lifecycle-reconcile",
	run: () =>
		Effect.gen(function* () {
			const service = yield* UserLifecycleService;
			yield* service.reconcilePending(100);
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("user lifecycle reconciliation listing failed", cause),
			),
		),
};
