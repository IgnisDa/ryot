export const importRunStatuses = ["pending", "running", "completed", "failed"] as const;

export type ImportRunStatus = (typeof importRunStatuses)[number];

export const importRunFailureStages = [
	"event_policy",
	"source_fetch",
	"database_commit",
	"provider_details",
	"provider_resolution",
	"input_transformation",
] as const;

export type ImportRunFailureStage = (typeof importRunFailureStages)[number];

export type ImportRunSource = string;
