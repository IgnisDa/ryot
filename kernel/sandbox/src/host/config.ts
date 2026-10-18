import type { Effect, Option } from "effect";
import { Context } from "effect";

// Host calls reach application persistence; the host bounds that work through this scope so a burst
// of nested calls cannot exhaust the application's own connections.
export class SandboxHostCallScope extends Context.Service<
	SandboxHostCallScope,
	{ readonly bound: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> }
>()("SandboxHostCallScope") {}

export class SandboxHostConfig extends Context.Service<
	SandboxHostConfig,
	{
		readonly runId: string;
		readonly tempDirectory: string;
		readonly perUserSidecars: boolean;
		readonly workerConcurrency: number;
		readonly memoryBudgetMiB: Option.Option<number>;
	}
>()("SandboxHostConfig") {}
