import { DbError } from "@ryot-app/contract/errors";
import {
	addCalendarDays,
	localDateOf,
	startOfLocalDay,
} from "@ryot-app/contract/modules/analytics/calendar";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	PluginId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { effectiveTimeZone, type TimeZone } from "@ryot-app/contract/schema/time-zone";
import {
	type SignalScheduleCandidate,
	signalSchedulePageRecipe,
} from "@ryot-app/ryotql-recipes/signal-schedules";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { Context, DateTime, Effect, Layer, Result, Schema } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { ProKeyService } from "#platform/pro-key";

import { type SignalScheduleCursor, SignalScheduleRepository } from "./repository";

const CATCH_UP_DAYS = 2;
const RETENTION_DAYS = 30;
const PRUNE_LIMIT = 500;
const TARGET_PAGE_SIZE = 50;
const TARGET_PAGE_LIMIT = 10;
const OCCURRENCE_PAGE_SIZE = 100;
const OCCURRENCE_PAGE_LIMIT = 5;

type SignalScheduleTarget = Effect.Success<
	ReturnType<SignalScheduleRepository["Service"]["listTargets"]>
>[number];

class SignalScheduleRecorded extends Schema.TaggedError<
	SignalScheduleRecorded,
	{ readonly brand: unique symbol }
>()("SignalScheduleRecorded", {}) {}

class SignalScheduleQueryError extends Schema.TaggedError<
	SignalScheduleQueryError,
	{ readonly brand: unique symbol }
>()("SignalScheduleQueryError", { cause: Schema.Unknown }) {}

export const signalScheduleBounds = (input: {
	now: Date;
	timeZone: TimeZone;
	delayDays: null | number;
	maxAgeHours: null | number;
	precision: "date" | "instant";
}) => {
	const now = DateTime.makeUnsafe(input.now);
	const today = localDateOf(input.now, input.timeZone);
	const first = addCalendarDays(today, -CATCH_UP_DAYS);
	const [start, end] =
		input.precision === "date"
			? [DateTime.makeUnsafe(first), DateTime.makeUnsafe(addCalendarDays(today, 1))]
			: [
					DateTime.makeUnsafe(startOfLocalDay(first, input.timeZone)),
					DateTime.add(now, { milliseconds: 1 }),
				];
	const delay = { days: input.delayDays ?? 0 };
	return {
		end: DateTime.formatIso(DateTime.subtract(end, delay)),
		start: DateTime.formatIso(DateTime.subtract(start, delay)),
		confirmedAfter:
			input.maxAgeHours === null
				? null
				: DateTime.formatIso(DateTime.subtract(now, { hours: input.maxAgeHours })),
	};
};

export class SignalScheduleWorker extends Context.Service<SignalScheduleWorker>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/worker/SignalScheduleWorker",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const proKey = yield* ProKeyService;
			const session = yield* DatabaseSession;
			const ryotql = yield* RyotQLService;
			const receipts = yield* MutationReceipts;
			const signals = yield* SignalEmissionService;
			const execution = yield* LifecycleExecution;
			const repository = yield* SignalScheduleRepository;

			const admit = Effect.fn("SignalScheduleWorker.admit")(function* (
				target: SignalScheduleTarget,
				candidate: SignalScheduleCandidate,
				now: Date,
			) {
				const userId = UserId.make(target.userId);
				const executionId = AutomationExecutionId.make(
					`signal-schedule:${sha256Base64Url(
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
									slug: SignalSchemaSlug.make(target.signal),
									owner: { kind: "plugin", pluginId: PluginId.make(target.pluginId) },
								},
							});
							if (plan.trigger.blockedReason !== null) {
								return yield* new DbError({ message: "Scheduled signal was blocked" });
							}
							const recorded = yield* repository.record({
								userId,
								scheduleSlug: target.slug,
								pluginId: target.pluginId,
								triggerId: plan.trigger.id,
								occurrenceKey: candidate.occurrence,
							});
							if (!recorded) {
								return yield* new SignalScheduleRecorded();
							}
							return toLifecycleDispatchPlan(plan);
						}),
					)
					.pipe(
						Effect.catchTags({
							DatabaseSessionStateError: Effect.die,
							SignalScheduleRecorded: () => Effect.succeed(null),
						}),
					);
			});

			const deliverTarget = Effect.fn("SignalScheduleWorker.deliverTarget")(function* (
				target: SignalScheduleTarget,
				now: Date,
			) {
				const bounds = signalScheduleBounds({
					now,
					delayDays: target.delayDays,
					precision: target.precision,
					maxAgeHours: target.freshness?.maxAgeHours ?? null,
					timeZone: effectiveTimeZone(target.preferences.reportingTimeZone),
				});
				const ledger = {
					scheduleSlug: target.slug,
					pluginId: target.pluginId,
					userId: UserId.make(target.userId),
				};
				let after: string | undefined;
				for (let page = 0; page < OCCURRENCE_PAGE_LIMIT; page++) {
					const recipe = yield* Effect.fromResult(
						Result.mapError(
							signalSchedulePageRecipe({
								after,
								bounds,
								schedule: target,
								limit: OCCURRENCE_PAGE_SIZE,
							}),
							(cause) => new SignalScheduleQueryError({ cause }),
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
							(cause) => new SignalScheduleQueryError({ cause }),
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

			const run = Effect.fn("SignalScheduleWorker.run")(function* () {
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
							Effect.logWarning("Signal schedule delivery pruning failed", cause),
						),
					);
				const isPro = yield* proKey.isValidated;
				let after: null | SignalScheduleCursor = null;
				for (let page = 0; page < TARGET_PAGE_LIMIT; page++) {
					const targets: ReadonlyArray<SignalScheduleTarget> = yield* repository.listTargets(
						after,
						TARGET_PAGE_SIZE,
					);
					for (const target of targets) {
						if (target.requiresProKey && !isPro) {
							continue;
						}
						yield* deliverTarget(target, now).pipe(
							Effect.catchCause((cause) =>
								Effect.logWarning("Signal schedule delivery deferred", cause).pipe(
									Effect.annotateLogs({
										userId: target.userId,
										scheduleSlug: target.slug,
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
