import { definePluginConfig, integerField } from "@ryot/config";
import type { AppNumberPropertyValidation } from "@ryot/contract/schema/property-schema";

const nonNegativeValidation: AppNumberPropertyValidation = { minimum: 0 };

const fitnessConfigDefinition = definePluginConfig("fitness", {
	exercisePreloadLimit: integerField({
		defaultValue: 873,
		label: "Exercise preload limit",
		validation: nonNegativeValidation,
		description: "Maximum number of built-in exercises preloaded during startup",
	}),
});

export const fitnessConfigSchema = fitnessConfigDefinition.schema;
