import { Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const FitnessSettingsInput = Schema.Struct({ artifactHandle: Schema.NonEmptyString });
export const FitnessSettingsOutput = Schema.Struct({ timezone: Schema.String });
