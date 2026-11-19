import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { UserBootstrapScheduling } from "./scheduling";

export const userBootstrapFrequentTask: CronTask<never, UserBootstrapScheduling> = {
	name: "user-bootstrap-reconcile",
	run: () =>
		Effect.gen(function* () {
			const scheduling = yield* UserBootstrapScheduling;
			yield* scheduling.reconcile(100);
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("user bootstrap reconciliation listing failed", cause),
			),
		),
};
