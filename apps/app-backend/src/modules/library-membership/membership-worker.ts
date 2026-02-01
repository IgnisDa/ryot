import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { CollectionsService } from "#modules/collections/service";

import { EnsureLibraryMembershipQueue } from "./durable-queues";

export const EnsureLibraryMembershipWorkerLive = DurableQueue.worker(
	EnsureLibraryMembershipQueue,
	(payload) =>
		Effect.gen(function* () {
			yield* Effect.annotateCurrentSpan({
				userId: payload.userId,
				entityId: payload.entityId,
				executionId: payload.executionId,
			});
			const collections = yield* CollectionsService;
			yield* collections.ensureEntityInLibrary(payload.userId, payload.entityId);
		}),
);
