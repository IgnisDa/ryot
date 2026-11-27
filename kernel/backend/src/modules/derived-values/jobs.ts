import { DbError } from "@ryot-app/contract/errors";
import { Duration, Effect, Layer, Schedule } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventMutations } from "#modules/events/mutations";
import { publishDerivedDataUpdated } from "#modules/live-updates/publish";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";

import { FoldJob, FoldMarks, FoldRebuildJob } from "./marks";
import { FoldReservation, Folds } from "./service";

const FoldJobLive = registerJobHandler(FoldJob, (subject, job) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const marks = yield* FoldMarks.make;
		const folds = yield* Folds;
		const mutations = yield* EventMutations;
		yield* Effect.gen(function* () {
			const reservation = yield* folds.reserve(subject);
			yield* mutations
				.transaction(marks.markSubjects([subject]), "job")
				.pipe(Effect.provideService(FoldReservation, reservation));
		}).pipe(
			Effect.scoped,
			Effect.retry({
				schedule: Schedule.spaced(Duration.millis(100)),
				while: (error) => error instanceof DbError && error.code === "55P03",
			}),
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
