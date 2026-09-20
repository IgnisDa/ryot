import { Schema } from "@ryot-app/sandbox-sdk/workflow";

export const FitnessSettingsInput = Schema.Struct({
	source: Schema.String,
	artifactHandle: Schema.NonEmptyString,
});
export const FitnessSettingsOutput = Schema.Struct({ timezone: Schema.String });
