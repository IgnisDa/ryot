import { definePluginConfig } from "@ryot-app/config";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";

import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

const fitnessConfigDefinition = definePluginConfig(PluginPackageId.make(PLUGIN_PACKAGE_ID), {});

export const fitnessConfigSchema = fitnessConfigDefinition.schema;
