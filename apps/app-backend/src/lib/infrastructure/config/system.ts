import type { Effect } from "effect";
import { Config as EffectConfig } from "effect";

import { appConfigDefinition } from "./definition";

const tmpDir = EffectConfig.string("TMPDIR").pipe(
	EffectConfig.orElse(() => EffectConfig.string("TMP")),
	EffectConfig.orElse(() => EffectConfig.string("TEMP")),
	EffectConfig.withDefault("/tmp"),
);

export const SystemConfigSource = EffectConfig.all({
	tmpDir,
	config: appConfigDefinition.config,
}).pipe(
	EffectConfig.map(({ config, tmpDir: tempDirectory }) =>
		Object.assign(config, { tmpDir: tempDirectory }),
	),
);

export type SystemConfigValue = Effect.Success<typeof SystemConfigSource>;
