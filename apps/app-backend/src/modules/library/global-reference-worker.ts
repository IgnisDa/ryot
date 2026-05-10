import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { CollectionsService } from "#modules/collections/service";
import { GlobalEntityReferencedQueue } from "#modules/events/durable-queues";

export const GlobalEntityReferencedWorkerLive = DurableQueue.worker(
	GlobalEntityReferencedQueue,
	(payload) =>
		Effect.gen(function* () {
			const collections = yield* CollectionsService;
			yield* collections.ensureEntityInLibrary(payload.userId, payload.entityId);
		}),
);
