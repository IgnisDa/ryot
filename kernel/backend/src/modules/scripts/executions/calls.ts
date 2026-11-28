import { SandboxRunError, TimeoutError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { Context, Effect, Layer } from "effect";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";

import { ExecutableArtifacts } from "../registry/executable-artifacts";
import {
	sandboxExecutionFailure,
	type SandboxExecutionResult,
	stampSandboxExecutionError,
} from "./result";
import { infrastructureRunError } from "./run-error";

const toRunError = (error: unknown) => {
	if (error instanceof SandboxRunError) {
		return error;
	}
	if (error instanceof TimeoutError) {
		return new SandboxRunError({ kind: "timeout", message: error.message });
	}
	if (error instanceof SidecarRecoverySuspended) {
		return new SandboxRunError({
			kind: "resource-unavailable",
			message: "Sandbox instance recovery is suspended",
		});
	}
	return infrastructureRunError(error);
};

export type ScriptCall = {
	readonly input: unknown;
	readonly lane: ExecutionLane;
	readonly executionId: string;
	readonly principal: ScriptExecutionPrincipal;
};

type Run = (call: ScriptCall) => Effect.Effect<SandboxExecutionResult>;

/**
 * Runs a pinned script once on the plain host, with no workflow, journal, or durable host. A run
 * holds one sandbox lease and releases it before returning, so no caller holds a lease while
 * another script waits for one.
 */
export class ScriptCalls extends Context.Service<ScriptCalls, { readonly run: Run }>()(
	"@ryot-app/kernel-backend/modules/scripts/executions/calls/ScriptCalls",
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const artifacts = yield* ExecutableArtifacts;
			const sandbox = yield* SandboxExecutor;
			return {
				run: Effect.fn("ScriptCalls.run")(function* (call: ScriptCall) {
					const startedAt = yield* sandboxStartedAt;
					return yield* Effect.gen(function* () {
						const artifact = yield* artifacts.get(call.principal);
						const result = yield* sandbox.run({
							startedAt,
							lane: call.lane,
							context: call.input,
							principal: call.principal,
							executionId: call.executionId,
							compiledCode: artifact.compiledCode,
							compiledFormat: artifact.compiledFormat,
						});
						if (result.recovery !== undefined) {
							yield* sandbox.completeRecovery(result.recovery);
						}
						return {
							logs: result.logs,
							value: result.value,
							timing: result.timing,
							status: "completed" as const,
							error:
								result.error === null
									? null
									: stampSandboxExecutionError(call.principal, result.error),
						};
					}).pipe(
						Effect.catch((error) => Effect.succeed(sandboxExecutionFailure(toRunError(error)))),
					);
				}),
			};
		}),
	);
}
