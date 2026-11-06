import { Effect, Layer } from "effect";

import { EventMutations } from "#modules/events/mutations";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";
import { publishDerivedDataUpdated, RedisService } from "#platform/redis";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { Folds } from "./service";

export const FoldJobLive = registerJobHandler(FoldJob, (subject, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const mutations = yield* EventMutations;
		const redis = yield* RedisService;
		yield* mutations
			.transaction(marks.markSubjects([subject]), "job")
			.pipe(
				Effect.tapError(() =>
					job.attempt >= FoldJob.maxAttempts
						? session.transaction(folds.failed(subject)).pipe(Effect.ignore)
						: Effect.void,
				),
			);
		yield* publishDerivedDataUpdated(redis, subject.userId);
	}),
);

export const FoldRebuildJobLive = registerJobHandler(FoldRebuildJob, (payload) =>
	Effect.flatMap(Folds, (folds) => folds.rebuild(payload)),
);

export const FoldJobsLive = Layer.merge(FoldJobLive, FoldRebuildJobLive);
