import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventMutations } from "#modules/events/mutations";
import { publishDerivedDataUpdated } from "#modules/live-updates/publish";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { Folds } from "./service";

/** How many times a fold job runs a subject again after a write changed it during the run. */
export const FOLD_JOB_RERUNS = 2;

/**
 * Folds a job's subjects outside any transaction and writes each run's results in a short one that
 * rechecks the subjects' revisions. A subject that changed meanwhile runs again, at most
 * `FOLD_JOB_RERUNS` times, and then folds under its lock.
 */
export const foldQueued = Effect.fn("Folds.foldQueued")(function* (input: {
	readonly userId: UserId;
	readonly entityIds: ReadonlyArray<EntityId>;
}) {
	const folds = yield* Folds;
	const marks = yield* FoldMarks.make;
	const mutations = yield* EventMutations;
	let entityIds = input.entityIds;
	for (let attempt = 0; attempt <= FOLD_JOB_RERUNS && entityIds.length > 0; attempt++) {
		const changed: Array<EntityId> = [];
		for (const run of yield* folds.prepareQueued({ entityIds, userId: input.userId })) {
			const results = yield* folds.runQueued(run);
			changed.push(
				...(yield* mutations.transaction(
					(transaction) =>
						folds.commitQueued(transaction, run, results, mutations.applyFoldChanges),
					"job",
				)),
			);
		}
		entityIds = changed;
	}
	if (entityIds.length > 0) {
		const subjects = entityIds.map((entityId) => ({ entityId, userId: input.userId }));
		yield* mutations.transaction((transaction) => marks.markRefolds(transaction, subjects), "job");
	}
});

/** A job of several subjects that fails queues each subject alone, so one subject's failure stays its own. */
const FoldJobLive = registerJobHandler(FoldJob, ({ userId, entityIds }, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const subjects = entityIds.map((entityId) => ({ userId, entityId }));
		const fold = foldQueued({ userId, entityIds });
		yield* subjects.length > 1
			? fold.pipe(
					Effect.catch(() =>
						session
							.transaction(
								Effect.flatMap(marks.route({ subjects, sources: [] }), (resolved) =>
									marks.enqueue(resolved, 1),
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
