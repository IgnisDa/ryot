import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type SignalScheduleCursor = {
	readonly slug: string;
	readonly userId: string;
	readonly pluginId: string;
};

type SignalScheduleDeliveryRecord = typeof schema.signalScheduleDelivery.$inferInsert;

export class SignalScheduleRepository extends Context.Service<SignalScheduleRepository>()(
	"SignalScheduleRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const schedule = schema.definitionSignalSchedule;
			const plugin = schema.userPlugin;

			const listTargets = Effect.fn("SignalScheduleRepository.listTargets")(function* (
				after: null | SignalScheduleCursor,
				limit: number,
			) {
				return yield* session.run((db) =>
					db
						.select({
							slug: schedule.slug,
							dueAt: schedule.dueAt,
							query: schedule.query,
							userId: plugin.userId,
							signal: schedule.signal,
							subject: schedule.subject,
							pluginId: plugin.pluginId,
							delayDays: schedule.delayDays,
							freshness: schedule.freshness,
							precision: schedule.precision,
							occurrence: schedule.occurrence,
							properties: schedule.properties,
							preferences: schema.user.preferences,
							requiresProKey: schedule.requiresProKey,
							accountGeneration: schema.user.accountGeneration,
						})
						.from(plugin)
						.innerJoin(schedule, eq(schedule.pluginRevisionId, plugin.activeRevisionId))
						.innerJoin(
							schema.user,
							and(eq(schema.user.id, plugin.userId), isNull(schema.user.disabledAt)),
						)
						.innerJoin(
							schema.notificationSubscription,
							and(
								eq(schema.notificationSubscription.isActive, true),
								eq(schema.notificationSubscription.userId, plugin.userId),
								eq(schema.notificationSubscription.signalSchemaSlug, schedule.signal),
								eq(schema.notificationSubscription.signalSchemaPluginId, plugin.pluginId),
							),
						)
						.where(
							and(
								eq(plugin.isListed, true),
								eq(plugin.isDefinitionEffective, true),
								after === null
									? undefined
									: or(
											gt(plugin.userId, after.userId),
											and(eq(plugin.userId, after.userId), gt(plugin.pluginId, after.pluginId)),
											and(
												eq(plugin.userId, after.userId),
												eq(plugin.pluginId, after.pluginId),
												gt(schedule.slug, after.slug),
											),
										),
							),
						)
						.orderBy(asc(plugin.userId), asc(plugin.pluginId), asc(schedule.slug))
						.limit(limit),
				);
			});

			const listDelivered = Effect.fn("SignalScheduleRepository.listDelivered")(function* (
				target: { userId: UserId; pluginId: string; scheduleSlug: string },
				occurrenceKeys: ReadonlyArray<string>,
			) {
				if (occurrenceKeys.length === 0) {
					return new Set<string>();
				}
				const rows = yield* session.run((db) =>
					db
						.select({ occurrenceKey: schema.signalScheduleDelivery.occurrenceKey })
						.from(schema.signalScheduleDelivery)
						.where(
							and(
								eq(schema.signalScheduleDelivery.userId, target.userId),
								eq(schema.signalScheduleDelivery.pluginId, target.pluginId),
								eq(schema.signalScheduleDelivery.scheduleSlug, target.scheduleSlug),
								inArray(schema.signalScheduleDelivery.occurrenceKey, [...occurrenceKeys]),
							),
						),
				);
				return new Set(rows.map(({ occurrenceKey }) => occurrenceKey));
			});

			const record = Effect.fn("SignalScheduleRepository.record")(function* (
				row: SignalScheduleDeliveryRecord,
			) {
				const inserted = yield* session.run((db) =>
					db
						.insert(schema.signalScheduleDelivery)
						.values(row)
						.onConflictDoNothing()
						.returning({ triggerId: schema.signalScheduleDelivery.triggerId }),
				);
				return inserted.length > 0;
			});

			const prune = Effect.fn("SignalScheduleRepository.prune")(function* (
				before: Date,
				limit: number,
			) {
				yield* session.run((db) =>
					db.execute(sql`
						delete from ${schema.signalScheduleDelivery}
						where ctid in (
							select ctid from ${schema.signalScheduleDelivery}
							where ${lt(schema.signalScheduleDelivery.createdAt, before)}
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
