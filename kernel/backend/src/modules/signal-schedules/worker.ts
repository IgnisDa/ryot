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
import { type TimeZone, UTC } from "@ryot-app/contract/schema/time-zone";
import { selectRecipe } from "@ryot-app/ryotql";
import {
	type SignalScheduleCandidate,
	signalScheduleRecipe,
} from "@ryot-app/ryotql-recipes/signal-schedules";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { Context, DateTime, Effect, Layer, Option, Ref, Result, Schema } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { ChangeSets } from "#modules/changes/service";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { RyotQLService } from "#modules/ryotql/service";
import { AppConfig } from "#platform/config/service";
import { EntitlementService } from "#platform/entitlements";

import { type SignalScheduleCursor, SignalScheduleRepository } from "./repository";

const CATCH_UP_DAYS = 2;
const RETENTION_DAYS = 30;
const PRUNE_LIMIT = 500;
const SNAPSHOT_HOURS = 1;
const EVALUATION_RETENTION_HOURS = 48;
const TARGET_PAGE_SIZE = 50;
const TARGET_PAGE_LIMIT = 10;
const OCCURRENCE_PAGE_SIZE = 100;
const OCCURRENCE_PAGE_LIMIT = 5;

type SignalScheduleTarget = Effect.Success<
	ReturnType<SignalScheduleRepository["Service"]["listTargets"]>
>[number];

class SignalScheduleQueryError extends Schema.TaggedError<
	SignalScheduleQueryError,
	{ readonly brand: unique symbol }
>()("SignalScheduleQueryError", { cause: Schema.Unknown }) {}

const decode = <A>(result: Result.Result<A, unknown>) =>
	Effect.fromResult(Result.mapError(result, (cause) => new SignalScheduleQueryError({ cause })));

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

/** The first instant whose window holds a row due at `dueAt`. */
export const signalScheduleDueFrom = (input: {
	dueAt: string;
	timeZone: TimeZone;
	delayDays: null | number;
	precision: "date" | "instant";
}) => {
	const shifted = DateTime.add(DateTime.makeUnsafe(input.dueAt), { days: input.delayDays ?? 0 });
	return input.precision === "date"
		? DateTime.toDate(
				DateTime.makeUnsafe(
					startOfLocalDay(localDateOf(DateTime.toDate(shifted), UTC), input.timeZone),
				),
			)
		: DateTime.toDate(shifted);
};

export class SignalScheduleWorker extends Context.Service<SignalScheduleWorker>()(
	"@ryot-app/kernel-backend/modules/signal-schedules/worker/SignalScheduleWorker",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const entitlements = yield* EntitlementService;
			const ryotql = yield* RyotQLService;
			const admission = yield* AccountAdmission.make;
			const changeSets = yield* ChangeSets;
			const repository = yield* SignalScheduleRepository;
			const resumeAfter = yield* Ref.make<null | SignalScheduleCursor>(null);

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
					accountUserId: userId,
					itemIdentity: executionId,
					occurredAt: now.toISOString(),
					initiator: { id: userId, kind: "user" },
				});
				const ledger = { userId, scheduleSlug: target.slug, pluginId: target.pluginId };
				yield* changeSets.commit(
					{
						userId,
						signals: [
							{
								itemIdentity: "occurrence",
								properties: candidate.properties,
								principal: { userId, kind: "user" },
								subjectEntityId: EntityId.make(candidate.subjectId),
								reference: {
									slug: SignalSchemaSlug.make(target.signal),
									owner: { kind: "plugin", pluginId: PluginId.make(target.pluginId) },
								},
							},
						],
					},
					{ ...command, writeContext: null },
					{
						precondition: {
							check: Effect.fnUntraced(function* (transaction) {
								yield* admission.admitAccount(userId, transaction);
								return yield* repository.lockUndelivered(ledger, candidate.occurrence);
							}),
							written: Effect.fnUntraced(function* (result) {
								const [signal] = result.signals;
								if (signal?.plan.trigger.blockedReason !== null) {
									return yield* new DbError({ message: "Scheduled signal was blocked" });
								}
								return yield* repository.record({
									...ledger,
									triggerId: signal.plan.trigger.id,
									occurrenceKey: candidate.occurrence,
								});
							}),
						},
					},
				);
			});

			/** Delivers the target's new due occurrences and returns when its next known one is due. */
			const evaluateTarget = Effect.fn("SignalScheduleWorker.evaluateTarget")(function* (
				target: SignalScheduleTarget,
				now: Date,
			) {
				const timeZone = target.preferences.reportingTimeZone;
				const bounds = signalScheduleBounds({
					now,
					timeZone,
					delayDays: target.delayDays,
					precision: target.precision,
					maxAgeHours: target.freshness?.maxAgeHours ?? null,
				});
				const ledger = {
					scheduleSlug: target.slug,
					pluginId: target.pluginId,
					userId: UserId.make(target.userId),
				};
				const recipe = yield* decode(signalScheduleRecipe({ schedule: target }));
				const dueRecipe = selectRecipe(recipe, "signalScheduleDue");
				const execute = (query: string | undefined, after: string | undefined) =>
					ryotql.executeForUser(target.userId, target.preferences.contentLanguage, "kernel", {
						source: {
							kind: "inline",
							document: recipe.document,
							...(query === undefined ? {} : { query }),
						},
						pages: {
							signalScheduleDue: {
								limit: OCCURRENCE_PAGE_SIZE,
								...(after === undefined ? {} : { after }),
							},
						},
						arguments: {
							end: bounds.end,
							start: bounds.start,
							...(bounds.confirmedAfter === null ? {} : { confirmedAfter: bounds.confirmedAfter }),
						},
					});
				const first = yield* decode(recipe.decode(yield* execute(undefined, undefined)));
				let result = first.signalScheduleDue;
				for (let page = 1; ; page++) {
					const delivered = yield* repository.listDelivered(
						ledger,
						result.items.map(({ occurrence }) => occurrence),
					);
					for (const candidate of result.items) {
						if (delivered.has(candidate.occurrence)) {
							continue;
						}
						yield* admit(target, candidate, now);
					}
					if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) {
						return first.signalScheduleNext === null
							? null
							: signalScheduleDueFrom({
									timeZone,
									delayDays: target.delayDays,
									precision: target.precision,
									dueAt: first.signalScheduleNext,
								});
					}
					if (page === OCCURRENCE_PAGE_LIMIT) {
						return now;
					}
					result = yield* decode(
						dueRecipe.decode(yield* execute(dueRecipe.query, result.pageInfo.nextCursor)),
					);
				}
			});

			const run = Effect.fn("SignalScheduleWorker.run")(function* () {
				if (config.scheduler.disableDispatchers) {
					return;
				}
				const now = yield* DateTime.nowAsDate;
				const at = DateTime.makeUnsafe(now);
				yield* repository
					.prune(DateTime.toDate(DateTime.subtract(at, { days: RETENTION_DAYS })), PRUNE_LIMIT)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Signal schedule delivery pruning failed", cause),
						),
					);
				yield* repository
					.pruneEvaluations(
						DateTime.toDate(DateTime.subtract(at, { hours: EVALUATION_RETENTION_HOURS })),
					)
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Signal schedule evaluation pruning failed", cause),
						),
					);
				const snapshot = yield* repository.currentSnapshot();
				yield* repository
					.advanceSnapshots({
						now,
						snapshot,
						before: DateTime.toDate(DateTime.subtract(at, { hours: SNAPSHOT_HOURS })),
					})
					.pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("Signal schedule snapshot advance failed", cause),
						),
					);
				const active = yield* entitlements.current;
				let after = yield* Ref.get(resumeAfter);
				for (let page = 0; page < TARGET_PAGE_LIMIT; page++) {
					const targets: ReadonlyArray<SignalScheduleTarget> = yield* repository.listTargets({
						now,
						after,
						entitlements: active,
						limit: TARGET_PAGE_SIZE,
					});
					const evaluations = [];
					for (const target of targets) {
						const nextDueAt = yield* evaluateTarget(target, now).pipe(
							Effect.asSome,
							Effect.catchCause((cause) =>
								Effect.logWarning("Signal schedule delivery deferred", cause).pipe(
									Effect.annotateLogs({
										userId: target.userId,
										scheduleSlug: target.slug,
										pluginId: target.pluginId,
									}),
									Effect.as(Option.none()),
								),
							),
						);
						if (Option.isSome(nextDueAt)) {
							evaluations.push({
								snapshot,
								evaluatedAt: now,
								userId: target.userId,
								scheduleSlug: target.slug,
								pluginId: target.pluginId,
								nextDueAt: nextDueAt.value,
								timeZone: target.preferences.reportingTimeZone,
								contentLanguage: target.preferences.contentLanguage,
							});
						}
					}
					yield* repository.saveEvaluations(evaluations);
					const last = targets.at(-1);
					after =
						last === undefined || targets.length < TARGET_PAGE_SIZE
							? null
							: { slug: last.slug, userId: last.userId, pluginId: last.pluginId };
					if (after === null) {
						break;
					}
				}
				// Targets whose evaluation keeps failing stay listed, so the next run resumes after this one's last.
				yield* Ref.set(resumeAfter, after);
			});

			return { run };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
