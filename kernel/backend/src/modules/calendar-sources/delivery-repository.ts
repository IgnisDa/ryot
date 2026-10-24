import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type CalendarDeliveryCursor = {
	readonly slug: string;
	readonly userId: string;
	readonly pluginId: string;
};

type CalendarDeliveryRecord = typeof schema.calendarDelivery.$inferInsert;

export class CalendarDeliveryRepository extends Context.Service<CalendarDeliveryRepository>()(
	"CalendarDeliveryRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const source = schema.userCalendarSourceEffective;

			const listTargets = Effect.fn("CalendarDeliveryRepository.listTargets")(function* (
				after: null | CalendarDeliveryCursor,
				limit: number,
			) {
				const rows = yield* session.run((db) =>
					db
						.select({
							slug: source.slug,
							query: source.query,
							userId: source.userId,
							subject: source.subject,
							startAt: source.startAt,
							delivery: source.delivery,
							pluginId: source.pluginId,
							precision: source.precision,
							preferences: schema.user.preferences,
							accountGeneration: schema.user.accountGeneration,
						})
						.from(source)
						.innerJoin(
							schema.user,
							and(eq(schema.user.id, source.userId), isNull(schema.user.disabledAt)),
						)
						.innerJoin(
							schema.notificationSubscription,
							and(
								eq(schema.notificationSubscription.isActive, true),
								eq(schema.notificationSubscription.userId, source.userId),
								eq(schema.notificationSubscription.signalSchemaPluginId, source.pluginId),
								eq(
									schema.notificationSubscription.signalSchemaSlug,
									sql`${source.delivery}->>'signal'`,
								),
							),
						)
						.where(
							and(
								eq(source.isEffective, true),
								isNotNull(source.delivery),
								after === null
									? undefined
									: or(
											gt(source.userId, after.userId),
											and(eq(source.userId, after.userId), gt(source.pluginId, after.pluginId)),
											and(
												eq(source.userId, after.userId),
												eq(source.pluginId, after.pluginId),
												gt(source.slug, after.slug),
											),
										),
							),
						)
						.orderBy(asc(source.userId), asc(source.pluginId), asc(source.slug))
						.limit(limit),
				);
				return rows.flatMap(({ delivery, ...row }) => (delivery ? [{ ...row, delivery }] : []));
			});

			const listDelivered = Effect.fn("CalendarDeliveryRepository.listDelivered")(function* (
				target: { userId: UserId; pluginId: string; sourceSlug: string },
				occurrenceKeys: ReadonlyArray<string>,
			) {
				if (occurrenceKeys.length === 0) {
					return new Set<string>();
				}
				const rows = yield* session.run((db) =>
					db
						.select({ occurrenceKey: schema.calendarDelivery.occurrenceKey })
						.from(schema.calendarDelivery)
						.where(
							and(
								eq(schema.calendarDelivery.userId, target.userId),
								eq(schema.calendarDelivery.pluginId, target.pluginId),
								eq(schema.calendarDelivery.sourceSlug, target.sourceSlug),
								inArray(schema.calendarDelivery.occurrenceKey, [...occurrenceKeys]),
							),
						),
				);
				return new Set(rows.map(({ occurrenceKey }) => occurrenceKey));
			});

			const record = Effect.fn("CalendarDeliveryRepository.record")(function* (
				row: CalendarDeliveryRecord,
			) {
				const inserted = yield* session.run((db) =>
					db
						.insert(schema.calendarDelivery)
						.values(row)
						.onConflictDoNothing()
						.returning({ triggerId: schema.calendarDelivery.triggerId }),
				);
				return inserted.length > 0;
			});

			const prune = Effect.fn("CalendarDeliveryRepository.prune")(function* (
				before: Date,
				limit: number,
			) {
				yield* session.run((db) =>
					db.execute(sql`
						delete from ${schema.calendarDelivery}
						where ctid in (
							select ctid from ${schema.calendarDelivery}
							where ${lt(schema.calendarDelivery.createdAt, before)}
							limit ${limit}
						)
					`),
				);
			});

			return { prune, record, listTargets, listDelivered };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
