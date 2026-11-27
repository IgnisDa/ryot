import type { Effect } from "effect";
import { Config as EffectConfig } from "effect";

import { appConfigDefinition } from "./definition";

export const SystemConfigSource = appConfigDefinition.config.pipe(
	EffectConfig.map((config) => Object.assign(config, {})),
);

export type SystemConfigValue = Effect.Success<typeof SystemConfigSource>;
