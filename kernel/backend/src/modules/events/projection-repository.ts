import { DbError } from "@ryot-app/contract/errors";
import type { EventStreamUpdate } from "@ryot-app/contract/modules/events/stream-work";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { eventProjection } from "#schema/tables/event-projections";
import { event } from "#schema/tables/events";

export class EventProjectionRepository extends Context.Service<EventProjectionRepository>()(
	"@ryot-app/kernel-backend/modules/events/projection-repository/EventProjectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const publish = Effect.fn("EventProjectionRepository.publish")(function* (input: {
				userId: string;
				eventSchemaSlug: string;
				eventSchemaPluginId: string;
				streams: ReadonlyArray<{
					readonly streamId: string;
					readonly entityId: string;
					readonly updates: ReadonlyArray<typeof EventStreamUpdate.Type>;
				}>;
			}) {
				yield* session.requireTransaction.pipe(Effect.orDie);
				const updates = input.streams.flatMap(({ streamId, entityId, updates: items }) =>
					items.map((item) => ({ ...item, streamId, entityId })),
				);
				if (updates.length === 0) {
					return undefined;
				}
				const ids = updates.map((item) => item.eventId);
				const rows = yield* session.run((db) =>
					db
						.select({ id: event.id, entityId: event.entityId })
						.from(event)
						.where(
							and(
								inArray(event.id, ids),
								eq(event.userId, input.userId),
								eq(event.eventSchemaPluginId, input.eventSchemaPluginId),
								eq(event.eventSchemaSlug, input.eventSchemaSlug),
							),
						)
						.orderBy(event.id)
						.for("update"),
				);
				const entities = new Map(rows.map((row) => [row.id, row.entityId]));
				if (
					new Set(ids).size !== ids.length ||
					updates.some((item) => entities.get(item.eventId) !== item.entityId)
				) {
					return yield* new DbError({
						message: "Projection output targeted an event outside its stream",
					});
				}
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.insert(eventProjection)
						.values(
							updates.map((item) => ({
								updatedAt,
								eventId: item.eventId,
								streamId: item.streamId,
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
