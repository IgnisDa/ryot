import { unknownToMessage } from "@ryot-app/contract/errors";
import type { PluginCron } from "@ryot-app/contract/modules/plugins/manifest";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import type { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Cause, Clock, Context, Cron, Duration, Effect, Result, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";

type ActivePluginCron = {
	readonly cron: PluginCron;
	readonly pluginSlug: string;
};

type PluginCronTarget = {
	readonly cronSlug: string;
	readonly pluginSlug: string;
	readonly installationId: string | null;
};

type DueDispatch = readonly [PluginCronTarget, string];

const MINUTE_MS = Duration.toMillis(Duration.minutes(1));

const PLUGIN_CRON_DISPATCH_CONCURRENCY = 8;

export const pluginCronExecutionId = (
	pluginSlug: string,
	cronSlug: string,
	scheduledAt: number | string,
) => `plugin-cron-${pluginSlug.length}-${pluginSlug}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export const privatePluginCronExecutionId = (
	installationId: string,
	cronSlug: string,
	scheduledAt: number | string,
) =>
	`private-plugin-cron-${installationId.length}-${installationId}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export class PluginCronService extends Context.Service<PluginCronService>()("PluginCronService", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const loader = yield* PluginLoader;
		const engine = yield* WorkflowEngine;
		const runtime = yield* PluginRuntimeResolver;

		const list = (): ReadonlyArray<ActivePluginCron> =>
			Object.entries(loader.getSnapshot().plugins)
				.flatMap(([pluginSlug, plugin]) =>
					plugin.manifest.crons.map((cron) => ({ cron, pluginSlug })),
				)
				.sort(
					(left, right) =>
						left.pluginSlug.localeCompare(right.pluginSlug) ||
						left.cron.slug.localeCompare(right.cron.slug),
				);

		const resolveTarget = Effect.fn("PluginCronService.resolveTarget")(function* (
			entry: PluginCronTarget,
		) {
			if (entry.installationId === null) {
				const system = yield* runtime.resolveActivePluginCron({
					cronSlug: entry.cronSlug,
					pluginSlug: entry.pluginSlug,
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
					subject: { type: "user", userId: owned.userId } satisfies SandboxExecutionSubject,
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
					Effect.annotateLogs({
						executionId,
						cronSlug: entry.cronSlug,
						pluginSlug: entry.pluginSlug,
					}),
				);
				return { status: "notFound" as const };
			}
			const execution = yield* Effect.exit(
				engine.execute(SandboxScriptWorkflow, {
					executionId,
					payload: {
						input: {},
						executionId,
						resolutionMode: "exact",
						subject: resolved.subject,
						scriptId: resolved.script.id,
					},
				}),
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
											pluginSlug: entry.pluginSlug,
										}),
									)
								: Effect.void,
						),
						Effect.catchCause((cause) =>
							Effect.logError("plugin cron dispatch failed", cause).pipe(
								Effect.annotateLogs({
									executionId,
									cronSlug: entry.cronSlug,
									pluginSlug: entry.pluginSlug,
								}),
							),
						),
					),
				// Every private installation's crons now join this tick, and `dispatch` awaits its
				// script. Without bounded concurrency one slow user script would delay the next tick
				// for every other user and for the system crons.
				{ discard: true, concurrency: PLUGIN_CRON_DISPATCH_CONCURRENCY },
			);

		const dueDispatches = Effect.fn("PluginCronService.dueDispatches")(function* (
			entry: { readonly cron: PluginCron; readonly pluginSlug: string },
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
					Effect.annotateLogs({
						schedule,
						cronSlug: entry.cron.slug,
						pluginSlug: entry.pluginSlug,
					}),
				);
				return [];
			}
			const dueAt = Cron.next(parsed.success, scheduledAt - MINUTE_MS).getTime();
			return dueAt === scheduledAt ? [[target, executionId] as DueDispatch] : [];
		});

		const dispatchDue = (scheduledAt: number) =>
			Effect.gen(function* () {
				const system = yield* Effect.forEach(list(), (entry) =>
					dueDispatches(
						entry,
						scheduledAt,
						{ cronSlug: entry.cron.slug, pluginSlug: entry.pluginSlug, installationId: null },
						pluginCronExecutionId(entry.pluginSlug, entry.cron.slug, scheduledAt),
					),
				);
				const owned = yield* runtime.listPrivateCronSchedules().pipe(
					Effect.flatMap((schedules) =>
						Effect.forEach(schedules, (entry) =>
							dueDispatches(
								entry,
								scheduledAt,
								{
									cronSlug: entry.cron.slug,
									pluginSlug: entry.pluginSlug,
									installationId: entry.installationId,
								},
								privatePluginCronExecutionId(entry.installationId, entry.cron.slug, scheduledAt),
							),
						),
					),
					Effect.map((entries) => entries.flat()),
					Effect.catchCause((cause) =>
						Effect.logError("private plugin cron discovery failed", cause).pipe(
							Effect.as([] as ReadonlyArray<DueDispatch>),
						),
					),
				);
				yield* dispatchAll([...system.flat(), ...owned]);
			});

		const trigger = Effect.fn("PluginCronService.trigger")(function* (
			pluginSlug: PluginSlug,
			cronSlug: string,
			parentExecutionId: string,
		) {
			const executionId = pluginCronExecutionId(pluginSlug, cronSlug, parentExecutionId);
			const dispatched = yield* dispatch(
				{ cronSlug, pluginSlug, installationId: null },
				executionId,
			);
			return dispatched.status === "notFound"
				? { status: "notFound" as const, cronSlug, pluginSlug }
				: {
						cronSlug,
						pluginSlug,
						executionId,
						result: dispatched.result,
						status: dispatched.status,
					};
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
			yield* crons.dispatchDue(scheduledAt);
		});
		yield* tick.pipe(Effect.forever, Effect.forkScoped);
	}),
);
