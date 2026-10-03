import { Clock, Effect, Schema } from "effect";

import { makeActivity } from "./workflow-scope";

export const startWorkflowDeadline = (name: string, durationMs: number) =>
	makeActivity({
		success: Schema.Finite,
		name: `deadline-${name}`,
		execute: Clock.currentTimeMillis.pipe(Effect.map((now) => now + durationMs)),
	});
