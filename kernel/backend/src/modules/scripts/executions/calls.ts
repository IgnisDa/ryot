import { SandboxRunError, TimeoutError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { isAdmissionQueueFull } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { Context, Duration, Effect, Layer, Schedule } from "effect";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";

import { ExecutableArtifacts } from "../registry/executable-artifacts";
import {
	sandboxExecutionFailure,
	type SandboxExecutionResult,
	stampSandboxExecutionError,
} from "./result";
import { infrastructureRunError } from "./run-error";

const ADMISSION_RETRY = Schedule.spaced(Duration.millis(100)).pipe(Schedule.jittered);

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

/**
 * Runs a pinned script once on the plain host, with no workflow, journal, or durable host. Host
 * writes need a durable host call, so a script run this way can only read.
 */
export class ScriptCalls extends Context.Service<ScriptCalls>()(
	"@ryot-app/kernel-backend/modules/scripts/executions/calls/ScriptCalls",
	{
		make: Effect.gen(function* () {
			const artifacts = yield* ExecutableArtifacts;
			const sandbox = yield* SandboxExecutor;
			const run = Effect.fn("ScriptCalls.run")(function* (input: {
				readonly input: JsonValue;
				readonly lane: ExecutionLane;
				readonly executionId: string;
				readonly principal: ScriptExecutionPrincipal;
			}): Effect.fn.Return<SandboxExecutionResult> {
				const startedAt = yield* sandboxStartedAt;
				return yield* Effect.gen(function* () {
					const artifact = yield* artifacts.get(input.principal);
					const result = yield* sandbox.run({
						startedAt,
						lane: input.lane,
						context: input.input,
						principal: input.principal,
						executionId: input.executionId,
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
								: stampSandboxExecutionError(input.principal, result.error),
					};
				}).pipe(
					Effect.retry({ schedule: ADMISSION_RETRY, while: isAdmissionQueueFull }),
					Effect.catch((error) => Effect.succeed(sandboxExecutionFailure(toRunError(error)))),
				);
			});
			return { run };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
