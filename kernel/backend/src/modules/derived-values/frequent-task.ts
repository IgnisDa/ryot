import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";
import { DatabaseSession } from "#platform/db/session";

import { FoldMarks } from "./marks";

const REFRESH_LIMIT = 500;

/** Queues the folds of subjects whose values changed on their own since they folded. */
export const foldRefreshFrequentTask: CronTask<never, FoldMarks | DatabaseSession> = {
	name: "fold-refreshes",
	run: () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const marks = yield* FoldMarks;
			yield* session.transaction(marks.queueRefreshes(REFRESH_LIMIT));
		}).pipe(Effect.catchCause((cause) => Effect.logWarning("fold refresh queueing failed", cause))),
};
