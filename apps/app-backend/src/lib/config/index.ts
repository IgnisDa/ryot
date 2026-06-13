import { Context, Effect, Layer } from "effect";

import { SystemConfigSource, type SystemConfigValue } from "./system";

export class AppConfig extends Context.Tag("AppConfig")<AppConfig, SystemConfigValue>() {}

export const AppConfigLive = Layer.effect(
	AppConfig,
	Effect.flatMap(SystemConfigSource, Effect.succeed),
);

export type AppConfigValue = SystemConfigValue;

export { SystemConfigSource };

export type { SystemConfigValue };
