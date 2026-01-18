import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { DefaultSavedViewQueue } from "#modules/entity-schemas/durable-queues";

import { SavedViewsService } from "./service";

export const DefaultSavedViewWorkerLive = DurableQueue.worker(DefaultSavedViewQueue, (payload) =>
	Effect.gen(function* () {
		const service = yield* SavedViewsService;
		yield* service
			.createDefaultForSchema({
				icon: payload.icon,
				userId: payload.userId,
				trackerId: payload.trackerId,
				accentColor: payload.accentColor,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaName: payload.entitySchemaName,
			})
			.pipe(Effect.catchTag("Conflict", () => Effect.void));
	}),
);
