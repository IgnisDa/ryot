import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { Context, Effect, Layer, Schema } from "effect";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";

import { ExecutableArtifacts } from "../registry/executable-artifacts";
import {
	sandboxExecutionFailure,
	type SandboxExecutionResult,
	type StampedSandboxExecutionError,
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
	readonly contextBytes?: number;
	readonly principal: ScriptExecutionPrincipal;
};

/** A run's outcome: its decoded output, or the failure that stopped it or its output. */
export type ScriptCallResult<A> = Omit<SandboxExecutionResult, "error"> &
	(
		| { readonly output: A; readonly error: null }
		| { readonly output?: never; readonly error: StampedSandboxExecutionError }
	);

/** Decodes a run's value as `output`; a value that does not decode fails as `invalid-output`. */
export const decodeScriptCall = <A>(
	result: SandboxExecutionResult,
	output: Schema.Decoder<A>,
): Effect.Effect<ScriptCallResult<A>> => {
	const { error, ...completed } = result;
	if (error !== null) {
		return Effect.succeed({ ...completed, error });
	}
	return Schema.decodeUnknownEffect(output)(result.value).pipe(
		Effect.match({
			onSuccess: (decoded) => ({ ...completed, error: null, output: decoded }),
			onFailure: (failure) => ({
				...completed,
				error: {
					phase: "output" as const,
					kind: "invalid-output" as const,
					message: `Script output is invalid: ${unknownToMessage(failure)}`,
				},
			}),
		}),
	);
};

type Run = <A>(call: ScriptCall, output: Schema.Decoder<A>) => Effect.Effect<ScriptCallResult<A>>;

/**
 * Runs a pinned script once on the plain host and decodes its output, with no workflow, journal, or durable host. A run
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
				run: Effect.fn("ScriptCalls.run")(function* <A>(
					call: ScriptCall,
					output: Schema.Decoder<A>,
				) {
					const startedAt = yield* sandboxStartedAt;
					const executed = yield* Effect.gen(function* () {
						const artifact = yield* artifacts.get(call.principal);
						const result = yield* sandbox.run({
							startedAt,
							lane: call.lane,
							context: call.input,
							...(call.contextBytes === undefined ? {} : { contextBytes: call.contextBytes }),
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
					return yield* decodeScriptCall(executed, output);
				}),
			};
		}),
	);
}
