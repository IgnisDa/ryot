import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { CronTask } from "#modules/scheduler/types";

import { PluginInstallationService } from "./installation-service";

export const pluginInstallationFrequentTask: CronTask<never, PluginInstallationService> = {
	name: "plugin-installation-reconcile",
	run: () =>
		Effect.flatMap(PluginInstallationService, (installations) =>
			installations.dispatchPendingInstallationLifecycle(),
		).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("plugin installation reconciliation failed", cause),
			),
		),
};

export const PluginInstallationSweepDispatcherLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig;
		if (config.scheduler.disableDispatchers) {
			yield* Effect.logInfo("plugin installation sweep dispatcher disabled");
			return;
		}
		const installations = yield* PluginInstallationService;
		yield* installations.dispatchPendingInstallationLifecycle();
	}),
);
