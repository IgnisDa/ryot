import { Layer } from "effect";

import { PluginRuntimeResolverLive } from "#modules/plugins/catalog/runtime-resolver";

import { PluginCronSchedulerLive, PluginCronService } from "./plugin-cron";

export const PluginCronServiceLive = PluginCronService.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
);

export const PluginCronSchedulerProvidedLive = PluginCronSchedulerLive.pipe(
	Layer.provide(PluginCronServiceLive),
);
