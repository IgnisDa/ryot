import { Effect, Layer } from "effect";

import { BackgroundWorkProjectionFinalizer } from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";

export const ProjectionFinalizerLive = Layer.effect(
	BackgroundWorkProjectionFinalizer,
	Effect.gen(function* () {
		const events = yield* EventStreamWorkService;
		const relationships = yield* RelationshipProjectionService;
		return {
			settled: (job) => relationships.reconcile(job.accountGeneration.userId),
			prepare: (job) =>
				job.purpose === "event-projection" ? events.prepare(job) : Effect.succeed(true),
			failed: (job) =>
				job.purpose === "relationship-projection" ? relationships.failed(job) : events.failed(job),
			publish: (job, output) => {
				if (job.purpose === "user-script") {
					return events.processInputRepair(job, output);
				}
				return job.purpose === "relationship-projection"
					? relationships.process(job, output)
					: events.process(job, output);
			},
		};
	}),
);

export const ProjectionRecoveryLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const events = yield* EventStreamWorkService;
		const background = yield* BackgroundWorkService;
		const relationships = yield* RelationshipProjectionService;
		yield* events
			.reconcile()
			.pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("Startup projection reconciliation failed", cause),
				),
			);
		yield* background
			.recover()
			.pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("Startup background recovery failed", cause),
				),
			);
		yield* relationships
			.reconcile()
			.pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("Startup relationship projection reconciliation failed", cause),
				),
			);
	}),
);
