import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { PluginSlug } from "@ryot/contract/schema/brands";
import type { PluginCron } from "@ryot/plugin-kit/manifest";
import { Clock, Cron, Duration, Effect, Either, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";

type ActivePluginCron = {
	readonly cron: PluginCron;
	readonly pluginSlug: string;
};

const MINUTE_MS = Duration.toMillis(Duration.minutes(1));

export const pluginCronExecutionId = (
	pluginSlug: string,
	cronSlug: string,
	scheduledAt: number | string,
) => `plugin-cron-${pluginSlug.length}-${pluginSlug}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export class PluginCronService extends Effect.Service<PluginCronService>()("PluginCronService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
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

		const dispatch = Effect.fn("PluginCronService.dispatch")(function* (
			entry: ActivePluginCron,
			executionId: string,
		) {
			const script = yield* runWithDb(
				entry.cron.lot === "script"
					? runtime.findActiveScript(entry.cron.scriptSlug)
					: runtime.findActiveWorkflowScript({
							pluginSlug: entry.pluginSlug,
							workflowSlug: entry.cron.workflowSlug,
						}),
			);
			if (!script) {
				yield* Effect.logError("plugin cron target unavailable").pipe(
					Effect.annotateLogs({
						executionId,
						cronSlug: entry.cron.slug,
						pluginSlug: entry.pluginSlug,
						targetSlug:
							entry.cron.lot === "script" ? entry.cron.scriptSlug : entry.cron.workflowSlug,
					}),
				);
				return { status: "notFound" as const };
			}
			if (entry.cron.lot === "workflow") {
				const result = yield* engine.execute(SandboxScriptWorkflow, {
					executionId,
					payload: {
						input: {},
						executionId,
						scriptId: script.id,
						resolutionMode: "exact",
						authority: { type: "system" },
					},
				});
				return { result, status: "executed" as const };
			}
			const result = yield* engine.execute(RunSandboxWorkflow, {
				executionId,
				payload: { context: {}, executionId, scriptId: script.id, authority: { type: "system" } },
			});
			return { result, status: "executed" as const };
		});

		const dispatchAll = (entries: ReadonlyArray<readonly [ActivePluginCron, string]>) =>
			Effect.forEach(
				entries,
				([entry, executionId]) =>
					dispatch(entry, executionId).pipe(
						Effect.catchAllCause((cause) =>
							Effect.logError("plugin cron dispatch failed", cause).pipe(
								Effect.annotateLogs({
									executionId,
									cronSlug: entry.cron.slug,
									pluginSlug: entry.pluginSlug,
								}),
							),
						),
					),
				{ discard: true },
			);

		const dispatchDue = (scheduledAt: number) =>
			Effect.gen(function* () {
				const due = yield* Effect.forEach(list(), (entry) =>
					Effect.gen(function* () {
						const schedule =
							"cron" in entry.cron.schedule
								? entry.cron.schedule.cron
								: config.scheduler.infrequentCronJobsSchedule;
						const parsed = Cron.parse(schedule, config.timezone);
						if (Either.isLeft(parsed)) {
							yield* Effect.logWarning("plugin cron schedule invalid").pipe(
								Effect.annotateLogs({
									schedule,
									cronSlug: entry.cron.slug,
									pluginSlug: entry.pluginSlug,
								}),
							);
							return [];
						}
						const dueAt = Cron.next(parsed.right, scheduledAt - MINUTE_MS).getTime();
						return dueAt === scheduledAt
							? [
									[
										entry,
										pluginCronExecutionId(entry.pluginSlug, entry.cron.slug, scheduledAt),
									] as const,
								]
							: [];
					}),
				);
				yield* dispatchAll(due.flat());
			});

		const trigger = Effect.fn("PluginCronService.trigger")(function* (
			pluginSlug: PluginSlug,
			cronSlug: string,
			parentExecutionId: string,
		) {
			const entry = list().find(
				(candidate) => candidate.pluginSlug === pluginSlug && candidate.cron.slug === cronSlug,
			);
			if (!entry) {
				return { status: "notFound" as const, cronSlug, pluginSlug };
			}
			const executionId = pluginCronExecutionId(pluginSlug, cronSlug, parentExecutionId);
			const dispatched = yield* dispatch(entry, executionId);
			return dispatched.status === "notFound"
				? { status: "notFound" as const, cronSlug, pluginSlug }
				: {
						cronSlug,
						pluginSlug,
						executionId,
						lot: entry.cron.lot,
						result: dispatched.result,
						status: "executed" as const,
					};
		});

		return { trigger, dispatchDue };
	}),
}) {}

export const PluginCronSchedulerLive = Layer.scopedDiscard(
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
