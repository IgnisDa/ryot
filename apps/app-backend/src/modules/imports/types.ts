export const importRunStatuses = ["pending", "running", "completed", "failed"] as const;

export type ImportRunStatus = (typeof importRunStatuses)[number];
