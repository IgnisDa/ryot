import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { PluginCron } from "@ryot/plugin-kit/manifest";
import { Clock, Cron, Duration, Effect, Either, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

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
			const script = yield* runWithDb(runtime.findActiveScript(entry.cron.scriptSlug));
			if (!script) {
				return yield* Effect.logError("plugin cron script unavailable").pipe(
					Effect.annotateLogs({
						executionId,
						cronSlug: entry.cron.slug,
						pluginSlug: entry.pluginSlug,
						scriptSlug: entry.cron.scriptSlug,
					}),
				);
			}
			return yield* engine
				.execute(RunSandboxWorkflow, {
					discard: true,
					executionId,
					payload: {
						authority: { type: "system" },
						context: {},
						executionId,
						scriptId: script.id,
					},
				})
				.pipe(Effect.asVoid);
		});

		const dispatchAll = (entries: ReadonlyArray<[ActivePluginCron, string]>) =>
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
			dispatchAll(
				list().flatMap((entry) => {
					const parsed = Cron.parse(entry.cron.schedule, config.timezone);
					if (Either.isLeft(parsed)) {
						return [];
					}
					const dueAt = Cron.next(parsed.right, scheduledAt - MINUTE_MS).getTime();
					return dueAt === scheduledAt
						? [[entry, pluginCronExecutionId(entry.pluginSlug, entry.cron.slug, scheduledAt)]]
						: [];
				}),
			);

		const triggerAll = (parentExecutionId: string) =>
			dispatchAll(
				list().map((entry) => [
					entry,
					pluginCronExecutionId(entry.pluginSlug, entry.cron.slug, parentExecutionId),
				]),
			);

		return { dispatchDue, triggerAll };
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
