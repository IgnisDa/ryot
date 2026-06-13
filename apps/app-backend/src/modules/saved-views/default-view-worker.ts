import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import { DbRunner } from "#lib/db";
import { DefaultSavedViewQueue } from "#modules/entity-schemas/durable-queues";

import { SavedViewsRepository } from "./repository";

export const DefaultSavedViewWorkerLive = DurableQueue.worker(DefaultSavedViewQueue, (payload) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SavedViewsRepository;
		yield* runWithDb(
			repository.createDefaultViewForSchema({
				icon: payload.icon,
				userId: payload.userId,
				trackerId: payload.trackerId,
				accentColor: payload.accentColor,
				entitySchemaSlug: payload.entitySchemaSlug,
				entitySchemaName: payload.entitySchemaName,
			}),
		).pipe(Effect.catchTag("Conflict", () => Effect.void));
	}),
);
