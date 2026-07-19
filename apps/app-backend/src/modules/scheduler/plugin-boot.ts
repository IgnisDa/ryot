import type { PluginBoot } from "@ryot/contract/modules/plugins/manifest";
import { Clock, Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";

type ActivePluginBoot = {
	readonly boot: PluginBoot;
	readonly pluginSlug: string;
};

type PluginBootIdentity = {
	readonly bootSlug: string;
	readonly pluginSlug: string;
};

export const pluginBootExecutionId = (
	pluginSlug: string,
	bootSlug: string,
	bootMs: number | string,
) => `plugin-boot-${pluginSlug.length}-${pluginSlug}-${bootSlug.length}-${bootSlug}-${bootMs}`;

export class PluginBootService extends Context.Service<PluginBootService>()("PluginBootService", {
	make: Effect.gen(function* () {
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
			entry: PluginBootIdentity,
			executionId: string,
		) {
			const resolved = yield* runWithDb(runtime.resolveActivePluginBoot(entry));
			if (!resolved) {
				return yield* Effect.logError("plugin boot script unavailable").pipe(
					Effect.annotateLogs({
						executionId,
						bootSlug: entry.bootSlug,
						pluginSlug: entry.pluginSlug,
					}),
				);
			}
			return yield* engine
				.execute(SandboxScriptWorkflow, {
					executionId,
					payload: {
						input: {},
						executionId,
						resolutionMode: "exact",
						scriptId: resolved.script.id,
						authority: { type: "system" },
					},
				})
				.pipe(Effect.asVoid);
		});

		const dispatchEntries = (entries: ReadonlyArray<[PluginBootIdentity, string]>) =>
			Effect.forEach(
				entries,
				([entry, executionId]) =>
					dispatch(entry, executionId).pipe(
						Effect.catchCause((cause) =>
							Effect.logError("plugin boot dispatch failed", cause).pipe(
								Effect.annotateLogs({
									executionId,
									bootSlug: entry.bootSlug,
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
					{ bootSlug: entry.boot.slug, pluginSlug: entry.pluginSlug },
					pluginBootExecutionId(entry.pluginSlug, entry.boot.slug, bootMs),
				]),
			);

		const triggerAll = (parentExecutionId: string) =>
			dispatchEntries(
				list().map((entry) => [
					{ bootSlug: entry.boot.slug, pluginSlug: entry.pluginSlug },
					pluginBootExecutionId(entry.pluginSlug, entry.boot.slug, parentExecutionId),
				]),
			);

		return { dispatchAll, triggerAll };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginBootDispatcherLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		if (config.scheduler.disableDispatchers) {
			yield* Effect.logInfo("plugin boot dispatcher disabled");
			return;
		}

		const boots = yield* PluginBootService;
		const bootMs = yield* Clock.currentTimeMillis;
		yield* boots.dispatchAll(bootMs);
	}),
);
