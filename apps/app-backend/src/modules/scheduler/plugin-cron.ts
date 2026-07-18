import type { PluginSlug } from "@ryot/contract/schema/brands";
import type { PluginCron } from "@ryot/plugin-kit/manifest";
import { Clock, Context, Cron, Duration, Effect, Result, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";
import { SandboxSubmissionWorkflow } from "#modules/sandbox/sandbox-submission-workflow";

type ActivePluginCron = {
	readonly cron: PluginCron;
	readonly pluginSlug: string;
};

type PluginCronIdentity = {
	readonly cronSlug: string;
	readonly pluginSlug: string;
};

const MINUTE_MS = Duration.toMillis(Duration.minutes(1));

export const pluginCronExecutionId = (
	pluginSlug: string,
	cronSlug: string,
	scheduledAt: number | string,
) => `plugin-cron-${pluginSlug.length}-${pluginSlug}-${cronSlug.length}-${cronSlug}-${scheduledAt}`;

export class PluginCronService extends Context.Service<PluginCronService>()("PluginCronService", {
	make: Effect.gen(function* () {
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
			entry: PluginCronIdentity,
			executionId: string,
		) {
			const resolved = yield* runWithDb(runtime.resolveActivePluginCron(entry));
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
			if (resolved.cron.lot === "workflow") {
				const result = yield* engine.execute(SandboxScriptWorkflow, {
					executionId,
					payload: {
						input: {},
						executionId,
						resolutionMode: "exact",
						scriptId: resolved.script.id,
						authority: { type: "system" },
					},
				});
				return { result, cron: resolved.cron, status: "executed" as const };
			}
			const result = yield* engine.execute(SandboxSubmissionWorkflow, {
				executionId,
				payload: {
					context: {},
					executionId,
					scriptId: resolved.script.id,
					authority: { type: "system" },
				},
			});
			return { result, cron: resolved.cron, status: "executed" as const };
		});

		const dispatchAll = (entries: ReadonlyArray<readonly [PluginCronIdentity, string]>) =>
			Effect.forEach(
				entries,
				([entry, executionId]) =>
					dispatch(entry, executionId).pipe(
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
						return dueAt === scheduledAt
							? [
									[
										{ cronSlug: entry.cron.slug, pluginSlug: entry.pluginSlug },
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
			const executionId = pluginCronExecutionId(pluginSlug, cronSlug, parentExecutionId);
			const dispatched = yield* dispatch({ cronSlug, pluginSlug }, executionId);
			return dispatched.status === "notFound"
				? { status: "notFound" as const, cronSlug, pluginSlug }
				: {
						cronSlug,
						pluginSlug,
						executionId,
						lot: dispatched.cron.lot,
						result: dispatched.result,
						status: "executed" as const,
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
