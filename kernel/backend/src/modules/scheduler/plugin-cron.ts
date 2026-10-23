import { unknownToMessage } from "@ryot-app/contract/errors";
import type { PluginCron } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Context, Cron, Duration, Effect, Layer, Result } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { AppConfig } from "#platform/config/service";

type PluginCronTarget = {
	readonly cronSlug: string;
	readonly pluginId: string;
	readonly installationId: string | null;
};

type DueDispatch = readonly [PluginCronTarget, string];

const MINUTE_MS = Duration.toMillis(Duration.minutes(1));

const PLUGIN_CRON_DISPATCH_CONCURRENCY = 8;

export const pluginCronExecutionId = (
	pluginId: string,
	cronSlug: string,
	scheduledAt: number | string,
) => `plugin-cron-${pluginId.length}-${pluginId}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export const privatePluginCronExecutionId = (
	installationId: string,
	cronSlug: string,
	scheduledAt: number | string,
) =>
	`private-plugin-cron-${installationId.length}-${installationId}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export class PluginCronService extends Context.Service<PluginCronService>()("PluginCronService", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const engine = yield* WorkflowEngine;
		const runtime = yield* PluginRuntimeResolver;
		const receipts = yield* MutationReceipts.make;

		const resolveTarget = Effect.fn("PluginCronService.resolveTarget")(function* (
			entry: PluginCronTarget,
		) {
			if (entry.installationId === null) {
				const system = yield* runtime.resolveActivePluginCron({
					cronSlug: entry.cronSlug,
					pluginId: entry.pluginId,
				});
				return (
					system && { ...system, subject: { type: "system" } satisfies SandboxExecutionSubject }
				);
			}
			const owned = yield* runtime.resolvePrivatePluginCron({
				cronSlug: entry.cronSlug,
				installationId: entry.installationId,
			});
			return (
				owned && {
					...owned,
					subject: {
						type: "user",
						userId: owned.userId,
						accountGeneration: yield* receipts.currentAccount(owned.userId),
					} satisfies SandboxExecutionSubject,
				}
			);
		});

		const dispatch = Effect.fn("PluginCronService.dispatch")(function* (
			entry: PluginCronTarget,
			executionId: string,
		) {
			const resolved = yield* resolveTarget(entry);
			if (!resolved) {
				yield* Effect.logError("plugin cron target unavailable").pipe(
					Effect.annotateLogs({ executionId, cronSlug: entry.cronSlug, pluginId: entry.pluginId }),
				);
				return { status: "notFound" as const };
			}
			const execution = yield* Effect.exit(
				dispatchAdmittedWorkflow(
					receipts,
					engine,
					ScriptExecutionWorkflow,
					resolved.subject.type === "system" ? null : resolved.subject.accountGeneration,
					{
						executionId,
						payload: {
							input: {},
							executionId,
							lane: "background",
							resolutionMode: "exact",
							subject: resolved.subject,
							scriptId: resolved.script.id,
						},
					},
					(admission) => admission,
					(run) => run,
				),
			);
			const result =
				execution._tag === "Success"
					? execution.value
					: {
							logs: [],
							value: null,
							status: "completed" as const,
							error: {
								phase: "execute" as const,
								message: unknownToMessage(Cause.squash(execution.cause)),
							},
						};
			return {
				result,
				cron: resolved.cron,
				status: execution._tag === "Failure" ? ("failed" as const) : ("executed" as const),
			};
		});

		const dispatchAll = (entries: ReadonlyArray<DueDispatch>) =>
			Effect.forEach(
				entries,
				([entry, executionId]) =>
					dispatch(entry, executionId).pipe(
						Effect.tap((result) =>
							result.status === "failed"
								? Effect.logError("plugin cron execution failed").pipe(
										Effect.annotateLogs({
											executionId,
											cronSlug: entry.cronSlug,
											pluginId: entry.pluginId,
										}),
									)
								: Effect.void,
						),
						Effect.catchCause((cause) =>
							Effect.logError("plugin cron dispatch failed", cause).pipe(
								Effect.annotateLogs({
									executionId,
									cronSlug: entry.cronSlug,
									pluginId: entry.pluginId,
								}),
							),
						),
					),
				{ discard: true, concurrency: PLUGIN_CRON_DISPATCH_CONCURRENCY },
			);

		const dueDispatches = Effect.fnUntraced(function* (
			entry: { readonly cron: PluginCron; readonly packageId: string },
			scheduledAt: number,
			target: PluginCronTarget,
			executionId: string,
		) {
			const schedule =
				"cron" in entry.cron.schedule
					? entry.cron.schedule.cron
					: config.scheduler.infrequentCronJobsSchedule;
			const parsed = Cron.parse(schedule, config.timezone);
			if (Result.isFailure(parsed)) {
				yield* Effect.logWarning("plugin cron schedule invalid").pipe(
					Effect.annotateLogs({ schedule, cronSlug: entry.cron.slug, packageId: entry.packageId }),
				);
				return [];
			}
			const dueAt = Cron.next(parsed.success, scheduledAt - MINUTE_MS).getTime();
			return dueAt === scheduledAt ? [[target, executionId] as DueDispatch] : [];
		});

		const dueSystemDispatches = Effect.fnUntraced(function* (scheduledAt: number) {
			const entries = yield* Effect.forEach(yield* runtime.listSystemCronSchedules(), (entry) =>
				dueDispatches(
					entry,
					scheduledAt,
					{ installationId: null, pluginId: entry.pluginId, cronSlug: entry.cron.slug },
					pluginCronExecutionId(entry.pluginId, entry.cron.slug, scheduledAt),
				),
			);
			return entries.flat();
		});

		const duePrivateDispatches = Effect.fnUntraced(function* (scheduledAt: number) {
			const schedules = yield* runtime.listPrivateCronSchedules();
			const entries = yield* Effect.forEach(schedules, (entry) =>
				dueDispatches(
					entry,
					scheduledAt,
					{
						pluginId: entry.pluginId,
						cronSlug: entry.cron.slug,
						installationId: entry.installationId,
					},
					privatePluginCronExecutionId(entry.installationId, entry.cron.slug, scheduledAt),
				),
			);
			return entries.flat();
		});

		const dispatchDue = Effect.fn("PluginCronService.dispatchDue")(function* (scheduledAt: number) {
			const system = yield* dueSystemDispatches(scheduledAt);
			const owned = yield* duePrivateDispatches(scheduledAt);
			yield* dispatchAll([...system, ...owned]);
		});

		const trigger = Effect.fn("PluginCronService.trigger")(function* (
			pluginId: PluginId,
			cronSlug: string,
			parentExecutionId: string,
		) {
			const executionId = pluginCronExecutionId(pluginId, cronSlug, parentExecutionId);
			const dispatched = yield* dispatch({ cronSlug, pluginId, installationId: null }, executionId);
			return dispatched.status === "notFound"
				? { cronSlug, pluginId, status: "notFound" as const }
				: { cronSlug, pluginId, executionId, result: dispatched.result, status: dispatched.status };
		});

		return { trigger, dispatchDue };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginCronSchedulerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		if (config.scheduler.disableDispatchers) {
			yield* Effect.logInfo("plugin cron scheduler disabled");
			return;
		}

		const crons = yield* PluginCronService;
		const tick = Effect.gen(function* () {
			const nowMs = yield* Clock.currentTimeMillis;
			const scheduledAt = (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;
			yield* Effect.sleep(Duration.millis(scheduledAt - nowMs));
			yield* crons.dispatchDue(scheduledAt).pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) => Effect.logError("plugin cron dispatch failed", cause),
				),
			);
		});
		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
