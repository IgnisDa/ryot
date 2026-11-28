import type { UserId } from "@ryot-app/contract/schema/brands";
import type { Entitlements } from "@ryot-app/contract/schema/entitlement";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	and,
	asc,
	eq,
	getColumns,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	not,
	or,
	type SQL,
	sql,
	type SQLWrapper,
} from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
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
			const changed = (userId: SQLWrapper, readSchemaSlugs: SQLWrapper) => sql`(
				exists (
					select 1 from ${change}
					where ${change.userId} = ${userId} and ${change.schemaSlug} is null and ${unseen}
				)
				or exists (
					select 1 from ${change}
					where ${change.userId} is null
						and (${change.schemaSlug} is null or ${readSchemaSlugs} is null
							or ${change.schemaSlug} = any(${readSchemaSlugs}))
						and ${unseen}
				)
			)`;

			const sameSettings = (preferences: SQLWrapper) =>
				and(
					sql`${evaluation.timeZone} is not distinct from ${preferences}->>'reportingTimeZone'`,
					sql`${evaluation.contentLanguage} is not distinct from ${preferences}->>'contentLanguage'`,
				);

			/**
			 * The current targets of the installations `installations` selects: each schedule in the
			 * active revision of a listed, effective plugin, for an active user with an active subscription
			 * to its signal, whose entitlement the deployment's `entitlements` hold.
			 */
			const currentTargets = Effect.fn("SignalScheduleRepository.currentTargets")(function* (
				installations: SQL,
				entitlements: Entitlements,
			) {
				const plugin = userPluginQuery(
					(yield* catalogs.listUserPlugins(installations)).filter(
						({ isListed, isDefinitionEffective }) => isListed && isDefinitionEffective,
					),
				).as("user_plugin");
				return new QueryBuilder()
					.select({
						slug: schedule.slug,
						dueAt: schedule.dueAt,
						query: schedule.query,
						userId: plugin.userId,
						signal: schedule.signal,
						subject: schedule.subject,
						pluginId: plugin.pluginId,
						instantAt: schedule.instantAt,
						delayDays: schedule.delayDays,
						freshness: schedule.freshness,
						precision: schedule.precision,
						occurrence: schedule.occurrence,
						properties: schedule.properties,
						entitlement: schedule.entitlement,
						preferences: schema.user.preferences,
						readSchemaSlugs: schedule.readSchemaSlugs,
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
						or(
							isNull(schedule.entitlement),
							entitlements.length === 0
								? undefined
								: inArray(schedule.entitlement, [...entitlements]),
						),
					)
					.as("target");
			});

			/**
			 * Lists the current targets that need evaluating: those whose next known occurrence is due by
			 * `now`, and those without a current evaluation, which is none, one in another time zone or
			 * content language, or one whose snapshot does not see a data change it may read.
			 */
			const listTargets = Effect.fn("SignalScheduleRepository.listTargets")(function* (input: {
				readonly now: Date;
				readonly limit: number;
				readonly entitlements: Entitlements;
				readonly after: null | SignalScheduleCursor;
			}) {
				const { after, limit } = input;
				const target = yield* currentTargets(
					after === null ? sql`true` : sql`i.user_id >= ${after.userId}`,
					input.entitlements,
				);
				const stale = or(
					isNull(evaluation.userId),
					not(sameSettings(target.preferences)),
					changed(target.userId, target.readSchemaSlugs),
				);
				return yield* session.run((db) =>
					db
						.select(getColumns(target))
						.from(target)
						.leftJoin(
							evaluation,
							and(
								eq(evaluation.userId, target.userId),
								eq(evaluation.pluginId, target.pluginId),
								eq(evaluation.scheduleSlug, target.slug),
							),
						)
						.where(
							and(
								or(stale, lte(evaluation.nextDueAt, input.now)),
								after === null
									? undefined
									: or(
											gt(target.userId, after.userId),
											and(eq(target.userId, after.userId), gt(target.pluginId, after.pluginId)),
											and(
												eq(target.userId, after.userId),
												eq(target.pluginId, after.pluginId),
												gt(target.slug, after.slug),
											),
										),
							),
						)
						.orderBy(asc(target.userId), asc(target.pluginId), asc(target.slug))
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
			 * Moves the snapshot of each current target's evaluation taken before `before` to `snapshot`,
			 * taken at `now`, when it has no unseen data change and no known occurrence due by `now`:
			 * evaluating it again would find nothing new.
			 */
			const advanceSnapshots = Effect.fn("SignalScheduleRepository.advanceSnapshots")(
				function* (input: {
					readonly now: Date;
					readonly before: Date;
					readonly snapshot: string;
					readonly entitlements: Entitlements;
				}) {
					const target = yield* currentTargets(
						sql`i.user_id in (select ${evaluation.userId} from ${evaluation} where ${lt(evaluation.evaluatedAt, input.before)})`,
						input.entitlements,
					);
					yield* session.run((db) =>
						db
							.update(evaluation)
							.set({ evaluatedAt: input.now, snapshot: input.snapshot })
							.from(target)
							.where(
								and(
									eq(target.userId, evaluation.userId),
									eq(target.pluginId, evaluation.pluginId),
									eq(target.slug, evaluation.scheduleSlug),
									sameSettings(target.preferences),
									lt(evaluation.evaluatedAt, input.before),
									gt(evaluation.nextDueAt, input.now),
									not(changed(evaluation.userId, target.readSchemaSlugs)),
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
