import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import { userPluginQuery } from "#modules/definitions/catalog-relations";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

export type SignalScheduleCursor = {
	readonly slug: string;
	readonly userId: string;
	readonly pluginId: string;
};

type SignalScheduleDeliveryRecord = typeof schema.signalScheduleDelivery.$inferInsert;

export class SignalScheduleRepository extends Context.Service<SignalScheduleRepository>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/repository/SignalScheduleRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;
			const schedule = schema.definitionSignalSchedule;

			const listTargets = Effect.fn("SignalScheduleRepository.listTargets")(function* (
				after: null | SignalScheduleCursor,
				limit: number,
			) {
				const plugin = userPluginQuery(
					(yield* catalogs.listUserPlugins(
						after === null ? sql`true` : sql`i.user_id >= ${after.userId}`,
					)).filter(({ isListed, isDefinitionEffective }) => isListed && isDefinitionEffective),
				).as("user_plugin");
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
							entitlement: schedule.entitlement,
							preferences: schema.user.preferences,
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

			/** Locks an occurrence's delivery until the transaction ends; true while none is recorded. */
			const lockUndelivered = Effect.fn("SignalScheduleRepository.lockUndelivered")(function* (
				target: { userId: UserId; pluginId: string; scheduleSlug: string },
				occurrenceKey: string,
			) {
				const key = stableStringify([
					"signal-schedule-delivery",
					target.userId,
					target.pluginId,
					target.scheduleSlug,
					occurrenceKey,
				]);
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`),
				);
				return (yield* listDelivered(target, [occurrenceKey])).size === 0;
			});

			const record = Effect.fn("SignalScheduleRepository.record")(function* (
				row: SignalScheduleDeliveryRecord,
			) {
				yield* session.run((db) => db.insert(schema.signalScheduleDelivery).values(row));
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

			return { prune, record, listTargets, listDelivered, lockUndelivered };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
