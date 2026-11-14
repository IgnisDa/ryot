import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { EntityGraphCollector } from "./collector";

export const entityGraphFrequentTask: CronTask<never, EntityGraphCollector> = {
	name: "entity-graph-collection",
	run: () =>
		Effect.gen(function* () {
			const collector = yield* EntityGraphCollector;
			yield* collector.runBatch(50);
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("entity graph collection batch failed", cause),
			),
		),
};
