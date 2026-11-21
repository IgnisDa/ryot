import { Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventMutations } from "#modules/events/mutations";
import { publishDerivedDataUpdated } from "#modules/live-updates/publish";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { Folds } from "./service";

/** A job of several subjects that fails queues each subject alone, so one subject's failure stays its own. */
const FoldJobLive = registerJobHandler(FoldJob, ({ userId, entityIds }, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const mutations = yield* EventMutations;
		const subjects = entityIds.map((entityId) => ({ userId, entityId }));
		const fold = mutations.transaction(marks.markSubjects(subjects), "job");
		yield* subjects.length > 1
			? fold.pipe(
					Effect.catch(() =>
						session
							.transaction(
								Effect.flatMap(marks.route({ subjects, sources: [] }), (resolved) =>
									marks.queueResolved(resolved, 1),
								),
							)
							.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
					),
				)
			: fold.pipe(
					Effect.tapError(() =>
						job.attempt >= FoldJob.maxAttempts
							? Effect.forEach(subjects, (subject) =>
									session.transaction(folds.failed(subject)),
								).pipe(Effect.ignore)
							: Effect.void,
					),
				);
		yield* publishDerivedDataUpdated(userId);
	}),
);

const FoldRebuildJobLive = registerJobHandler(FoldRebuildJob, (payload) =>
	Effect.flatMap(Folds, (folds) => folds.rebuild(payload)),
);

export const FoldJobsLive = Layer.merge(FoldJobLive, FoldRebuildJobLive).pipe(
	Layer.provide(DefinitionCatalog.layer),
);
