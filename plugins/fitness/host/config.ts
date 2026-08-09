import { definePluginConfig, integerField } from "@ryot-app/config";
import type { AppNumberPropertyValidation } from "@ryot-app/contract/schema/property-schema";

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
