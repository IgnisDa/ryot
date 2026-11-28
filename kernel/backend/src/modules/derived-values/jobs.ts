import { Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventMutations } from "#modules/events/mutations";
import { publishDerivedDataUpdated } from "#modules/live-updates/publish";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { Folds } from "./service";

/**
 * Folds a job's subjects. A job of several subjects that fails queues each subject alone, so one
 * subject's failure stays its own; a job that wrote derived state publishes the refresh hint.
 */
const FoldJobLive = registerJobHandler(FoldJob, ({ userId, entityIds }, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const mutations = yield* EventMutations;
		const fold = mutations.fold({ userId, entityIds, lane: "background" });
		const subjects = entityIds.map((entityId) => ({ userId, entityId }));
		const written = yield* entityIds.length > 1
			? fold.pipe(
					Effect.catch(() =>
						session
							.transaction(
								Effect.flatMap(marks.route({ subjects, sources: [] }), (resolved) =>
									marks.enqueue(resolved, 1),
								),
							)
							.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die), Effect.as(true)),
					),
				)
			: fold.pipe(
					Effect.tapError(() =>
						job.attempt >= FoldJob.maxAttempts
							? session.transaction(folds.failed(userId, entityIds)).pipe(Effect.ignore)
							: Effect.void,
					),
				);
		if (written) {
			yield* publishDerivedDataUpdated(userId);
		}
	}),
);

const FoldRebuildJobLive = registerJobHandler(FoldRebuildJob, (payload) =>
	Effect.flatMap(Folds, (folds) => folds.rebuild(payload)),
);

export const FoldJobsLive = Layer.merge(FoldJobLive, FoldRebuildJobLive).pipe(
	Layer.provide(DefinitionCatalog.layer),
);
