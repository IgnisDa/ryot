import { PluginExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema } from "../wire";

export const executeRyotqlDataSchema = Schema.Unknown;
export const executeRyotqlArgsSchema = Schema.Tuple([PluginExecutionRequest]);
export const executeRyotqlResultSchema = hostResultSchema(executeRyotqlDataSchema);
