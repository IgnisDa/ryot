import { Effect } from "effect";

import type { Database } from "#lib/infrastructure/db/service";
import type { CronTask } from "#modules/scheduler/types";

import { UserLifecycleService } from "./service";

export const userLifecycleFrequentTask: CronTask<never, Database | UserLifecycleService> = {
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
