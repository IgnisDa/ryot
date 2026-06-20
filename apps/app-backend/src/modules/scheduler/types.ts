import type { Effect } from "effect";

export type CronTaskContext = {
	executionId: string;
};

export type CronTask<E, R> = {
	name: string;
	run: (ctx: CronTaskContext) => Effect.Effect<void, E, R>;
};
