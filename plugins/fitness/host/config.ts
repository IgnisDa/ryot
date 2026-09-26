import { definePluginConfig } from "@ryot-app/config";

const fitnessConfigDefinition = definePluginConfig("fitness", {});

export const fitnessConfigSchema = fitnessConfigDefinition.schema;
