import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { Effect } from "effect";

export type InfrequentCronTask = {
	name: string;
	run: Effect.Effect<void, never, WorkflowEngine>;
};
