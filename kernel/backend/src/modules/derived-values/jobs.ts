import { Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventMutations } from "#modules/events/mutations";
import { publishDerivedDataUpdated } from "#modules/live-updates/publish";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { Folds, PreparedFold } from "./service";

const FoldJobLive = registerJobHandler(FoldJob, (subject, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const mutations = yield* EventMutations;
		const prepared = yield* folds.prepare(subject);
		yield* mutations.transaction(marks.markSubjects([subject]), "job").pipe(
			Effect.provideService(PreparedFold, prepared),
			Effect.tapError(() =>
				job.attempt >= FoldJob.maxAttempts
					? session.transaction(folds.failed(subject)).pipe(Effect.ignore)
					: Effect.void,
			),
		);
		yield* publishDerivedDataUpdated(subject.userId);
	}),
);

const FoldRebuildJobLive = registerJobHandler(FoldRebuildJob, (payload) =>
	Effect.flatMap(Folds, (folds) => folds.rebuild(payload)),
);

export const FoldJobsLive = Layer.merge(FoldJobLive, FoldRebuildJobLive).pipe(
	Layer.provide(DefinitionCatalog.layer),
);
