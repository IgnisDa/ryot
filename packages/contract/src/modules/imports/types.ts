export const importRunFailureStages = [
	"event_policy",
	"source_fetch",
	"database_commit",
	"provider_details",
	"provider_resolution",
	"input_transformation",
] as const;

export type ImportRunSource = string;

export type ImportRunFailureStage = (typeof importRunFailureStages)[number];
