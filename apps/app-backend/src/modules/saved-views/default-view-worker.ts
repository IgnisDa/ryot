import { DurableQueue } from "@effect/workflow";
import { Effect } from "effect";

import {
	type CreateDefaultSavedViewPayload,
	DefaultSavedViewQueue,
} from "#modules/entity-schemas/durable-queues";

import { SavedViewsService } from "./service";

export const processDefaultSavedView = (payload: CreateDefaultSavedViewPayload) =>
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
	});

export const DefaultSavedViewWorkerLive = DurableQueue.worker(DefaultSavedViewQueue, (payload) =>
	processDefaultSavedView(payload).pipe(
		Effect.withSpan("DefaultSavedViewQueue", {
			attributes: {
				userId: payload.userId,
				trackerId: payload.trackerId,
				executionId: payload.executionId,
			},
		}),
	),
);
