import { Effect, Layer } from "effect";

import { BackgroundWorkProjectionFinalizer } from "#modules/background-work/model";
import { EventStreamWorkService } from "#modules/events/stream-work";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";

export const ProjectionFinalizerLive = Layer.effect(
	BackgroundWorkProjectionFinalizer,
	Effect.gen(function* () {
		const events = yield* EventStreamWorkService;
		const relationships = yield* RelationshipProjectionService;
		return {
			failed: (job) =>
				job.purpose === "relationship-projection" ? relationships.failed(job) : events.failed(job),
			publish: (job, output) =>
				job.purpose === "relationship-projection"
					? relationships.process(job, output)
					: events.process(job, output),
		};
	}),
);
