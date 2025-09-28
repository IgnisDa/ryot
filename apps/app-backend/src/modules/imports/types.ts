export const importRunStatuses = ["pending", "running", "completed", "failed"] as const;

export type ImportRunStatus = (typeof importRunStatuses)[number];

export const importRunFailureStages = [
	"source_fetch",
	"database_commit",
	"provider_details",
	"provider_resolution",
	"event_before_trigger",
	"input_transformation",
] as const;

export type ImportRunFailureStage = (typeof importRunFailureStages)[number];
