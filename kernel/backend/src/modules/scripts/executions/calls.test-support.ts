import { Effect, Layer } from "effect";

import { type ScriptCall, ScriptCalls } from "./calls";
import type { SandboxExecutionResult } from "./result";

/** `ScriptCalls` running every call through `run`, as the runtime installs the sandbox. */
export const scriptCallsLayer = (
	run: (call: ScriptCall) => Effect.Effect<SandboxExecutionResult>,
) =>
	Layer.effectDiscard(Effect.flatMap(ScriptCalls, (calls) => calls.install(run))).pipe(
		Layer.provideMerge(ScriptCalls.layer),
	);

export const scriptCallResult = (value: unknown): SandboxExecutionResult => ({
	value,
	logs: [],
	error: null,
	status: "completed",
});
