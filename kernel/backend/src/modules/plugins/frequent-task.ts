import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { PluginCatalogInvalidator } from "./catalog-events";

export const pluginCatalogFrequentTask: CronTask<never, PluginCatalogInvalidator> = {
	name: "plugin-catalog-delivery",
	run: () =>
		Effect.gen(function* () {
			yield* (yield* PluginCatalogInvalidator).deliverPending(100);
		}).pipe(Effect.catchCause((cause) => Effect.logError("plugin catalog delivery failed", cause))),
};
