import { definePluginConfig } from "@ryot-app/config";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

const fitnessConfigDefinition = definePluginConfig(PLUGIN_PACKAGE_ID, {});

export const fitnessConfigSchema = fitnessConfigDefinition.schema;
