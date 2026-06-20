import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { Effect } from "effect";

export type CronTask<R> = {
	name: string;
	run: Effect.Effect<void, never, R>;
};

export type InfrequentCronTask = CronTask<WorkflowEngine>;
