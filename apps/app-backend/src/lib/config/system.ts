import type { Config } from "effect";

import { systemConfigDefinition } from "./definition";

export const SystemConfigSource = systemConfigDefinition;

export type SystemConfigValue = Config.Config.Success<typeof SystemConfigSource>;
