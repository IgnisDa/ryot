import { DbError } from "@ryot-app/contract/errors";
import type { EventStreamStepOutput } from "@ryot-app/contract/modules/events/stream-work";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { eventProjection } from "#schema/tables/event-projections";
import { event } from "#schema/tables/events";

export class EventProjectionRepository extends Context.Service<EventProjectionRepository>()(
	"EventProjectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const publish = Effect.fn("EventProjectionRepository.publish")(function* (input: {
				userId: string;
				streamId: string;
				entityId: string;
				eventSchemaSlug: string;
				eventSchemaPluginId: string;
				updates: (typeof EventStreamStepOutput.Type)["updates"];
			}) {
				yield* session.requireTransaction.pipe(Effect.orDie);
				if (input.updates.length === 0) {
					return undefined;
				}
				const ids = input.updates.map((item) => item.eventId);
				const rows = yield* session.run((db) =>
					db
						.select({ id: event.id })
						.from(event)
						.where(
							and(
								inArray(event.id, ids),
								eq(event.userId, input.userId),
								eq(event.entityId, input.entityId),
								eq(event.eventSchemaPluginId, input.eventSchemaPluginId),
								eq(event.eventSchemaSlug, input.eventSchemaSlug),
							),
						)
						.orderBy(event.id)
						.for("update"),
				);
				if (rows.length !== ids.length || new Set(ids).size !== ids.length) {
					return yield* new DbError({
						message: "Projection output targeted an event outside its stream",
					});
				}
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.insert(eventProjection)
						.values(
							input.updates.map((item) => ({
								updatedAt,
								eventId: item.eventId,
								streamId: input.streamId,
								properties: item.properties,
							})),
						)
						.onConflictDoUpdate({
							target: eventProjection.eventId,
							set: {
								updatedAt,
								streamId: sql`excluded.stream_id`,
								properties: sql`excluded.properties`,
							},
						}),
				);
				return undefined;
			});
			return { publish };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
