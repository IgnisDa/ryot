import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { PluginBoot } from "@ryot/plugin-kit/manifest";
import { Clock, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

type ActivePluginBoot = {
	readonly boot: PluginBoot;
	readonly pluginSlug: string;
};

export const pluginBootExecutionId = (
	pluginSlug: string,
	bootSlug: string,
	bootMs: number | string,
) => `plugin-boot-${pluginSlug.length}-${pluginSlug}-${bootSlug.length}-${bootSlug}-${bootMs}`;

export class PluginBootService extends Effect.Service<PluginBootService>()("PluginBootService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const loader = yield* PluginLoader;
		const engine = yield* WorkflowEngine;
		const runtime = yield* PluginRuntimeResolver;

		const list = (): ReadonlyArray<ActivePluginBoot> =>
			Object.entries(loader.getSnapshot().plugins)
				.flatMap(([pluginSlug, plugin]) =>
					plugin.manifest.boot.map((boot) => ({ boot, pluginSlug })),
				)
				.sort(
					(left, right) =>
						left.pluginSlug.localeCompare(right.pluginSlug) ||
						left.boot.slug.localeCompare(right.boot.slug),
				);

		const dispatch = Effect.fn("PluginBootService.dispatch")(function* (
			entry: ActivePluginBoot,
			executionId: string,
		) {
			const script = yield* runWithDb(runtime.findActiveScript(entry.boot.driverRef));
			if (!script) {
				return yield* Effect.logError("plugin boot script unavailable").pipe(
					Effect.annotateLogs({
						executionId,
						bootSlug: entry.boot.slug,
						pluginSlug: entry.pluginSlug,
						scriptSlug: entry.boot.driverRef,
					}),
				);
			}
			return yield* engine
				.execute(RunSandboxWorkflow, {
					discard: true,
					executionId,
					payload: {
						context: {},
						executionId,
						userId: null,
						driverName: "boot",
						scriptId: script.id,
					},
				})
				.pipe(Effect.asVoid);
		});

		const dispatchEntries = (entries: ReadonlyArray<[ActivePluginBoot, string]>) =>
			Effect.forEach(
				entries,
				([entry, executionId]) =>
					dispatch(entry, executionId).pipe(
						Effect.catchAllCause((cause) =>
							Effect.logError("plugin boot dispatch failed", cause).pipe(
								Effect.annotateLogs({
									executionId,
									bootSlug: entry.boot.slug,
									pluginSlug: entry.pluginSlug,
								}),
							),
						),
					),
				{ discard: true },
			);

		const dispatchAll = (bootMs: number) =>
			dispatchEntries(
				list().map((entry) => [
					entry,
					pluginBootExecutionId(entry.pluginSlug, entry.boot.slug, bootMs),
				]),
			);

		const triggerAll = (parentExecutionId: string) =>
			dispatchEntries(
				list().map((entry) => [
					entry,
					pluginBootExecutionId(entry.pluginSlug, entry.boot.slug, parentExecutionId),
				]),
			);

		return { dispatchAll, triggerAll };
	}),
}) {}

export const PluginBootDispatcherLive = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		if (config.server.disableBackgroundJobs) {
			yield* Effect.logInfo("plugin boot dispatcher disabled");
			return;
		}

		const boots = yield* PluginBootService;
		const bootMs = yield* Clock.currentTimeMillis;
		yield* boots.dispatchAll(bootMs).pipe(Effect.forkScoped);
	}),
);
