import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	and,
	asc,
	eq,
	exists,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	not,
	or,
	sql,
	type SQLWrapper,
} from "drizzle-orm";
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
type SignalScheduleEvaluationRecord = typeof schema.signalScheduleEvaluation.$inferInsert;

export class SignalScheduleRepository extends Context.Service<SignalScheduleRepository>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/repository/SignalScheduleRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const catalogs = yield* DefinitionCatalog;
			const schedule = schema.definitionSignalSchedule;
			const evaluation = schema.signalScheduleEvaluation;
			const change = schema.dataChange;

			const currentSnapshot = Effect.fn("SignalScheduleRepository.currentSnapshot")(function* () {
				const { rows } = yield* session.run((db) =>
					db.execute<{ snapshot: string }>(sql`select pg_current_snapshot()::text as snapshot`),
				);
				const [row] = rows;
				if (row === undefined) {
					return yield* Effect.die(new Error("PostgreSQL returned no snapshot"));
				}
				return row.snapshot;
			});

			const unseen = sql`${change.transactionId} >= pg_snapshot_xmin(${evaluation.snapshot})
				and not pg_visible_in_snapshot(${change.transactionId}, ${evaluation.snapshot})`;

			/**
			 * Whether the evaluation's snapshot does not see a data change of the target's user, a global
			 * change to a schema the schedule reads, or a global change without a schema.
			 */
			const changed = (userId: SQLWrapper) => sql`(
				exists (
					select 1 from ${change}
					where ${change.userId} = ${userId} and ${change.schemaSlug} is null and ${unseen}
				)
				or exists (
					select 1 from ${change}
					where ${change.userId} is null
						and (${change.schemaSlug} is null or ${schedule.readSchemaSlugs} is null
							or ${change.schemaSlug} = any(${schedule.readSchemaSlugs}))
						and ${unseen}
				)
			)`;

			const sameSettings = and(
				sql`${evaluation.timeZone} is not distinct from ${schema.user.preferences}->>'reportingTimeZone'`,
				sql`${evaluation.contentLanguage} is not distinct from ${schema.user.preferences}->>'contentLanguage'`,
			);

			/**
			 * Lists the targets to evaluate: those whose next known occurrence is due by `now`, and those
			 * without a current evaluation, which is none, one in another time zone or content language,
			 * or one whose snapshot does not see a data change it may read.
			 */
			const listTargets = Effect.fn("SignalScheduleRepository.listTargets")(function* (input: {
				readonly now: Date;
				readonly limit: number;
				readonly after: null | SignalScheduleCursor;
			}) {
				const { after, limit } = input;
				const plugin = userPluginQuery(
					(yield* catalogs.listUserPlugins(
						after === null ? sql`true` : sql`i.user_id >= ${after.userId}`,
					)).filter(({ isListed, isDefinitionEffective }) => isListed && isDefinitionEffective),
				).as("user_plugin");
				const stale = or(isNull(evaluation.userId), not(sameSettings), changed(plugin.userId));
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
						.leftJoin(
							evaluation,
							and(
								eq(evaluation.userId, plugin.userId),
								eq(evaluation.pluginId, plugin.pluginId),
								eq(evaluation.scheduleSlug, schedule.slug),
							),
						)
						.where(
							and(
								or(stale, lte(evaluation.nextDueAt, input.now)),
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

			const saveEvaluations = Effect.fn("SignalScheduleRepository.saveEvaluations")(function* (
				rows: ReadonlyArray<SignalScheduleEvaluationRecord>,
			) {
				if (rows.length === 0) {
					return;
				}
				yield* session.run((db) =>
					db
						.insert(evaluation)
						.values([...rows])
						.onConflictDoUpdate({
							target: [evaluation.userId, evaluation.pluginId, evaluation.scheduleSlug],
							set: {
								snapshot: sql`excluded.snapshot`,
								timeZone: sql`excluded.time_zone`,
								nextDueAt: sql`excluded.next_due_at`,
								evaluatedAt: sql`excluded.evaluated_at`,
								contentLanguage: sql`excluded.content_language`,
							},
						}),
				);
			});

			/**
			 * Moves the snapshot of each current evaluation taken before `before` to `snapshot`, taken at
			 * `now`, when it has no unseen data change and no known occurrence due by `now`: evaluating it
			 * again would find nothing new.
			 */
			const advanceSnapshots = Effect.fn("SignalScheduleRepository.advanceSnapshots")(
				function* (input: {
					readonly now: Date;
					readonly before: Date;
					readonly snapshot: string;
				}) {
					yield* session.run((db) =>
						db
							.update(evaluation)
							.set({ evaluatedAt: input.now, snapshot: input.snapshot })
							.from(schedule)
							.innerJoin(
								schema.plugin,
								eq(schema.plugin.activeRevisionId, schedule.pluginRevisionId),
							)
							.innerJoin(schema.user, isNull(schema.user.disabledAt))
							.where(
								and(
									sameSettings,
									eq(schema.user.id, evaluation.userId),
									eq(schema.plugin.id, evaluation.pluginId),
									eq(schedule.slug, evaluation.scheduleSlug),
									lt(evaluation.evaluatedAt, input.before),
									or(isNull(evaluation.nextDueAt), gt(evaluation.nextDueAt, input.now)),
									exists(
										db
											.select({ id: schema.notificationSubscription.id })
											.from(schema.notificationSubscription)
											.where(
												and(
													eq(schema.notificationSubscription.isActive, true),
													eq(schema.notificationSubscription.userId, evaluation.userId),
													eq(schema.notificationSubscription.signalSchemaSlug, schedule.signal),
													eq(
														schema.notificationSubscription.signalSchemaPluginId,
														evaluation.pluginId,
													),
												),
											),
									),
									not(changed(evaluation.userId)),
								),
							),
					);
				},
			);

			/** Deletes evaluations no run kept current, then the data changes every evaluation sees. */
			const pruneEvaluations = Effect.fn("SignalScheduleRepository.pruneEvaluations")(function* (
				evaluatedBefore: Date,
			) {
				yield* session.run((db) =>
					db.delete(evaluation).where(lt(evaluation.evaluatedAt, evaluatedBefore)),
				);
				yield* session.run((db) =>
					db.execute(sql`
						delete from ${change}
						where ${change.transactionId} < least(
							pg_snapshot_xmin(pg_current_snapshot()),
							(select min(pg_snapshot_xmin(${evaluation.snapshot})) from ${evaluation})
						)
					`),
				);
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

			return {
				prune,
				record,
				listTargets,
				listDelivered,
				currentSnapshot,
				lockUndelivered,
				saveEvaluations,
				advanceSnapshots,
				pruneEvaluations,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(DefinitionCatalog.layer),
	);
}
