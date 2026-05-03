import { Schema } from "effect";

export const runStatuses = ["pending", "running", "completed", "failed"] as const;

export const RunStatus = Schema.Literals([...runStatuses]);

export type RunStatus = typeof RunStatus.Type;
