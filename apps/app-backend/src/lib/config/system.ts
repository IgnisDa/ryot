import type { Config } from "effect";

import { systemConfigDef } from "./definition";

export const SystemConfigSource = systemConfigDef;

export type SystemConfigValue = Config.Config.Success<typeof SystemConfigSource>;
