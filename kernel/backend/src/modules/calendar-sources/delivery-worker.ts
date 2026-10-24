import { DbError } from "@ryot-app/contract/errors";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	PluginId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	type CalendarDeliveryCandidate,
	calendarDeliveryPageRecipe,
} from "@ryot-app/ryotql-recipes/calendar";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { Context, Data, DateTime, Effect, Layer, Result } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";

import { type CalendarDeliveryCursor, CalendarDeliveryRepository } from "./delivery-repository";

const CATCH_UP_DAYS = 2;
const RETENTION_DAYS = 30;
const PRUNE_LIMIT = 500;
const TARGET_PAGE_SIZE = 50;
const TARGET_PAGE_LIMIT = 10;
const OCCURRENCE_PAGE_SIZE = 100;
const OCCURRENCE_PAGE_LIMIT = 5;

type CalendarDeliveryTarget = Effect.Success<
	ReturnType<CalendarDeliveryRepository["Service"]["listTargets"]>
>[number];

class CalendarDeliveryRecorded extends Data.TaggedError("CalendarDeliveryRecorded") {}

class CalendarDeliveryQueryError extends Data.TaggedError("CalendarDeliveryQueryError")<{
	readonly cause: unknown;
}> {}

export const calendarDeliveryBounds = (input: {
	now: Date;
	timeZone: string;
	maxAgeHours: null | number;
	precision: "date" | "instant";
}) => {
	const now = DateTime.makeUnsafe(input.now);
	const today = DateTime.makeUnsafe(
		DateTime.formatIsoDate(DateTime.makeZonedUnsafe(now, { timeZone: input.timeZone })),
	);
	const first = DateTime.subtract(today, { days: CATCH_UP_DAYS });
	return {
		confirmedAfter:
			input.maxAgeHours === null
				? null
				: DateTime.formatIso(DateTime.subtract(now, { hours: input.maxAgeHours })),
		...(input.precision === "date"
			? {
					start: DateTime.formatIso(first),
					end: DateTime.formatIso(DateTime.add(today, { days: 1 })),
				}
			: {
					end: DateTime.formatIso(DateTime.add(now, { milliseconds: 1 })),
					start: DateTime.formatIso(
						DateTime.toUtc(
							DateTime.makeZonedUnsafe(first, {
								adjustForTimeZone: true,
								timeZone: input.timeZone,
							}),
						),
					),
				}),
	};
};

export class CalendarDeliveryWorker extends Context.Service<CalendarDeliveryWorker>()(
	"CalendarDeliveryWorker",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const session = yield* DatabaseSession;
			const ryotql = yield* RyotQLService;
			const receipts = yield* MutationReceipts;
			const signals = yield* SignalEmissionService;
			const execution = yield* LifecycleExecution;
			const repository = yield* CalendarDeliveryRepository;

			const admit = Effect.fn("CalendarDeliveryWorker.admit")(function* (
				target: CalendarDeliveryTarget,
				candidate: CalendarDeliveryCandidate,
				now: Date,
			) {
				const userId = UserId.make(target.userId);
				const executionId = AutomationExecutionId.make(
					`calendar-delivery:${sha256Base64Url(
						identityTupleKey(target.userId, target.pluginId, target.slug, candidate.occurrence),
					)}`,
				);
				const command = rootLifecycleCommand({
					executionId,
					lane: "background",
					source: "scheduler",
					itemIdentity: executionId,
					occurredAt: now.toISOString(),
					initiator: { id: userId, kind: "user" },
					accountGeneration: { userId, token: target.accountGeneration },
				});
				return yield* session
					.transaction(
						Effect.gen(function* () {
							yield* receipts.admitAccount({ userId, token: target.accountGeneration });
							const plan = yield* signals.planSignal({
								properties: candidate.properties,
								principal: { userId, kind: "user" },
								command: { ...command, writeContext: null },
								subjectEntityId: EntityId.make(candidate.subjectId),
								reference: {
									slug: SignalSchemaSlug.make(target.delivery.signal),
									owner: { kind: "plugin", pluginId: PluginId.make(target.pluginId) },
								},
							});
							if (plan.trigger.blockedReason !== null) {
								return yield* new DbError({ message: "Calendar delivery signal was blocked" });
							}
							const recorded = yield* repository.record({
								userId,
								sourceSlug: target.slug,
								pluginId: target.pluginId,
								triggerId: plan.trigger.id,
								occurrenceKey: candidate.occurrence,
							});
							if (!recorded) {
								return yield* new CalendarDeliveryRecorded();
							}
							return toLifecycleDispatchPlan(plan);
						}),
					)
					.pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							CalendarDeliveryRecorded: () => Effect.succeed(null),
						}),
					);
			});

			const deliverTarget = Effect.fn("CalendarDeliveryWorker.deliverTarget")(function* (
				target: CalendarDeliveryTarget,
				now: Date,
			) {
				const bounds = calendarDeliveryBounds({
					now,
					precision: target.precision,
					timeZone: target.preferences.reportingTimeZone ?? "UTC",
					maxAgeHours: target.delivery.freshness?.maxAgeHours ?? null,
				});
				const ledger = {
					sourceSlug: target.slug,
					pluginId: target.pluginId,
					userId: UserId.make(target.userId),
				};
				let after: string | undefined;
				for (let page = 0; page < OCCURRENCE_PAGE_LIMIT; page++) {
					const recipe = yield* Effect.fromResult(
						Result.mapError(
							calendarDeliveryPageRecipe({
								after,
								bounds,
								source: target,
								limit: OCCURRENCE_PAGE_SIZE,
							}),
							(cause) => new CalendarDeliveryQueryError({ cause }),
						),
					);
					const response = yield* ryotql.executeForUser(
						target.userId,
						target.preferences.language,
						"kernel",
						recipe.document,
					);
					const result = yield* Effect.fromResult(
						Result.mapError(
							recipe.decode(response),
							(cause) => new CalendarDeliveryQueryError({ cause }),
						),
					);
					const delivered = yield* repository.listDelivered(
						ledger,
						result.items.map(({ occurrence }) => occurrence),
					);
					for (const candidate of result.items) {
						if (delivered.has(candidate.occurrence)) {
							continue;
						}
						const dispatch = yield* admit(target, candidate, now);
						if (dispatch !== null) {
							yield* execution.dispatch([dispatch]);
						}
					}
					if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) {
						return;
					}
					after = result.pageInfo.nextCursor;
				}
			});

			const run = Effect.fn("CalendarDeliveryWorker.run")(function* () {
				if (config.scheduler.disableDispatchers) {
					return;
				}
				const now = yield* DateTime.nowAsDate;
				yield* repository
					.prune(
						DateTime.toDate(DateTime.subtract(DateTime.makeUnsafe(now), { days: RETENTION_DAYS })),
						PRUNE_LIMIT,
					)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Calendar delivery pruning failed", cause),
						),
					);
				let after: null | CalendarDeliveryCursor = null;
				for (let page = 0; page < TARGET_PAGE_LIMIT; page++) {
					const targets: ReadonlyArray<CalendarDeliveryTarget> = yield* repository.listTargets(
						after,
						TARGET_PAGE_SIZE,
					);
					for (const target of targets) {
						yield* deliverTarget(target, now).pipe(
							Effect.catchCause((cause) =>
								Effect.logWarning("Calendar delivery deferred", cause).pipe(
									Effect.annotateLogs({
										userId: target.userId,
										sourceSlug: target.slug,
										pluginId: target.pluginId,
									}),
								),
							),
						);
					}
					const last = targets.at(-1);
					if (last === undefined || targets.length < TARGET_PAGE_SIZE) {
						return;
					}
					after = { slug: last.slug, userId: last.userId, pluginId: last.pluginId };
				}
			});

			return { run };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
