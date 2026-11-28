import { SandboxRunError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";

import { decodeScriptCall, type ScriptCall, ScriptCalls } from "./calls";
import { sandboxExecutionFailure, type SandboxExecutionResult } from "./result";

/** `ScriptCalls` running every call through `run`, whose value decodes like a sandbox run's. */
export const scriptCallsLayer = (
	run: (call: ScriptCall) => Effect.Effect<SandboxExecutionResult>,
) =>
	Layer.succeed(ScriptCalls, {
		run: (call, output) => Effect.flatMap(run(call), (result) => decodeScriptCall(result, output)),
	});

/** `ScriptCalls` for suites that start no script: every call fails as `resource-unavailable`. */
export const unavailableScriptCallsLayer = scriptCallsLayer(() =>
	Effect.succeed(
		sandboxExecutionFailure(
			new SandboxRunError({ kind: "resource-unavailable", message: "The sandbox is not running" }),
		),
	),
);

export const scriptCallResult = (value: unknown): SandboxExecutionResult => ({
	value,
	logs: [],
	error: null,
	status: "completed",
});
