import { Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { PluginInstallationService } from "./installation-service";

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
