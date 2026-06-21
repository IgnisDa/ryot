import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { CollectionsService } from "#modules/collections/service";
import { EnsureLibraryMembershipQueue } from "#modules/events/durable-queues";

export const EnsureLibraryMembershipWorkerLive = DurableQueue.worker(
	EnsureLibraryMembershipQueue,
	(payload) =>
		Effect.gen(function* () {
			const collections = yield* CollectionsService;
			yield* collections.ensureEntityInLibrary(payload.userId, payload.entityId);
		}),
);
